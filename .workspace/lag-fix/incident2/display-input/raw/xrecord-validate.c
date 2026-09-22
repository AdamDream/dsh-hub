/* xrecord-validate.c
 * Determines the correct XRecordInterceptData layout empirically.
 *
 * Rationale: X11/extensions/record.h is absent on this distro, so the struct
 * layout is reconstructed from the canonical libXtst definition. Instead of
 * assuming it is right, this probe validates it against server-side invariants:
 *   - the FIRST event of a Record stream is always category XRecordStartOfData (=4)
 *     and carries data_len == 0;
 *   - every other event has category 0..3 and a data_len matching a real X event.
 * Candidate layouts are ranked by how well they satisfy those invariants.
 */
#include <X11/Xlib.h>
#include <X11/Xmd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef unsigned long XRecordContext;
typedef unsigned long XRecordClientSpec;
typedef struct {
    CARD8  coreRequestsFirst, coreRequestsLast;
    CARD8  coreRepliesFirst, coreRepliesLast;
    CARD8  extRequestsMajorFirst, extRequestsMajorLast;
    CARD16 extRequestsMinorFirst, extRequestsMinorLast;
    CARD8  extRepliesMajorFirst, extRepliesMajorLast;
    CARD16 extRepliesMinorFirst, extRepliesMinorLast;
    CARD8  deliveredEventsFirst, deliveredEventsLast;
    CARD8  deviceEventsFirst, deviceEventsLast;
    CARD8  errorsFirst, errorsLast;
    BOOL   clientStarted, clientDied;
} XRecordRange;
typedef struct XRecordInterceptData XRecordInterceptData;
typedef void (*XRecordInterceptProc)(XPointer, XRecordInterceptData *);

extern Bool          XRecordQueryVersion(Display *, int *, int *);
extern XRecordRange *XRecordAllocRange(void);
extern XRecordContext XRecordCreateContext(Display *, int, XRecordClientSpec *,
                                           int, XRecordRange **, int);
extern Status XRecordEnableContextAsync(Display *, XRecordContext,
                                        XRecordInterceptProc, XPointer);
extern void XRecordProcessReplies(Display *);
extern void XRecordDisableContext(Display *, XRecordContext);
extern void XRecordFreeContext(Display *, XRecordContext);
extern void XRecordFreeData(XRecordInterceptData *);

/* Candidate A: id, category, server_time, client_seq, server_seq, data_len, data*
 * Candidate B: same but WITHOUT server_seq (32-bit-era layout)              */
typedef struct {
    unsigned long id;
    int category;
    Bool server_time;
    unsigned long client_seq;
    unsigned long server_seq;
    unsigned long data_len;
    unsigned char *data;
} LayoutA;

typedef struct {
    unsigned long id;
    int category;
    Bool server_time;
    unsigned long client_seq;
    unsigned long data_len;
    unsigned char *data;
} LayoutB;

static int n = 0, shown = 0;
static int a_start_ok = 0, a_cat_ok = 0, a_len_ok = 0, a_total = 0;
static int b_start_ok = 0, b_cat_ok = 0, b_len_ok = 0, b_total = 0;
static unsigned char *first_data = NULL;
static unsigned long first_len = 0;
static int first_len_from_a = -1;

static void cb(XPointer cl, XRecordInterceptData *d) {
    (void)cl;
    if (!d) return;
    LayoutA *a = (LayoutA *)d;
    LayoutB *b = (LayoutB *)d;

    if (n == 0) {
        printf("--- FIRST event (must be category=4 XRecordStartOfData, data_len=0) ---\n");
        printf("LayoutA: id=%lu category=%d server_time=%d client_seq=%lu server_seq=%lu data_len=%lu\n",
               a->id, a->category, (int)a->server_time, a->client_seq, a->server_seq, a->data_len);
        printf("LayoutB: id=%lu category=%d server_time=%d client_seq=%lu data_len=%lu\n",
               b->id, b->category, (int)b->server_time, b->client_seq, b->data_len);
        printf("--> A.startOfData=%s A.len0=%s | B.startOfData=%s B.len0=%s\n",
               a->category == 4 ? "YES" : "no", a->data_len == 0 ? "YES" : "no",
               b->category == 4 ? "YES" : "no", b->data_len == 0 ? "YES" : "no");
        if (a->category == 4 && a->data_len == 0) { a_start_ok++; first_len_from_a = 1; }
        if (b->category == 4 && b->data_len == 0) { b_start_ok++; first_len_from_a = 0; }
    }
    n++;
    if (a->category >= 0 && a->category <= 3) a_cat_ok++;
    if (b->category >= 0 && b->category <= 3) b_cat_ok++;
    /* a real core event is >= 32 bytes; data_len==0 only for Start/End of data */
    if (a->data_len >= 32 || a->data_len == 0) a_len_ok++;
    if (b->data_len >= 32 || b->data_len == 0) b_len_ok++;
    a_total++; b_total++;

    if (shown < 6 && a->category <= 3 && a->data_len >= 32) {
        int type = a->data ? (a->data[0] & 0x7f) : -1;
        printf("  event[%d] A: cat=%d data_len=%lu first_byte_type=%d\n",
               n, a->category, a->data_len, type);
        shown++;
    }
    if (first_data == NULL && a->data && a->data_len >= 32) {
        first_data = a->data; first_len = a->data_len;
    }
    XRecordFreeData(d);
}

int main(int argc, char **argv) {
    double secs = (argc > 1) ? atof(argv[1]) : 2.0;
    Display *c = XOpenDisplay(NULL);
    Display *dd = XOpenDisplay(NULL);
    if (!c || !dd) { fprintf(stderr, "cannot open display\n"); return 2; }
    int maj, min;
    if (!XRecordQueryVersion(c, &maj, &min)) { fprintf(stderr, "no RECORD\n"); return 3; }
    printf("XRecord %d.%d, sizeof(LayoutA)=%zu sizeof(LayoutB)=%zu\n",
           maj, min, sizeof(LayoutA), sizeof(LayoutB));
    XRecordRange *r = XRecordAllocRange();
    memset(r, 0, sizeof(XRecordRange));
    r->deviceEventsFirst = KeyPress;
    r->deviceEventsLast  = MotionNotify;
    XRecordClientSpec cs = 3;
    XRecordContext ctx = XRecordCreateContext(c, 0, &cs, 1, &r, 1);
    if (!ctx) { fprintf(stderr, "createContext failed\n"); return 3; }
    XFlush(c);
    if (!XRecordEnableContextAsync(dd, ctx, cb, NULL)) {
        fprintf(stderr, "enable failed\n"); return 3;
    }
    struct timespec t0; clock_gettime(CLOCK_MONOTONIC, &t0);
    double start = t0.tv_sec + t0.tv_nsec / 1e9;
    while (1) {
        while (XPending(dd)) XRecordProcessReplies(dd);
        struct timespec now; clock_gettime(CLOCK_MONOTONIC, &now);
        if ((now.tv_sec + now.tv_nsec / 1e9) - start > secs) break;
        struct timespec s = {0, 2000000}; nanosleep(&s, NULL);
    }
    XRecordDisableContext(c, ctx);
    XRecordFreeContext(c, ctx);
    printf("\n=== VALIDATION (events=%d) ===\n", n);
    printf("LayoutA: startOfData=%d/%d  category_in_0_3=%d/%d  len_plausible=%d/%d\n",
           a_start_ok, 1, a_cat_ok, a_total, a_len_ok, a_total);
    printf("LayoutB: startOfData=%d/%d  category_in_0_3=%d/%d  len_plausible=%d/%d\n",
           b_start_ok, 1, b_cat_ok, b_total, b_len_ok, b_total);
    printf("VERDICT: %s layout is correct\n",
           (a_start_ok && a_cat_ok == a_total) ? "A (with server_seq)" :
           (b_start_ok && b_cat_ok == b_total) ? "B (without server_seq)" : "NEITHER - inconclusive");
    return 0;
}
