/* input-rate-probe.c
 * READ-ONLY, NON-GRABBING X11 global input event-rate sampler using XRecord.
 * XRecord taps the server's event stream WITHOUT grabbing any device, so it
 * does not disturb the running session. Compiles and runs unprivileged.
 *
 * Usage: input-rate-probe <seconds>
 */
#include <X11/Xlib.h>
#include <X11/Xmd.h>                    /* CARD8/16/32, BOOL */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static Display *dpy_data = NULL;
static unsigned long n_motion = 0, n_button = 0, n_key = 0, n_other = 0;
static double t_first = 0, t_last = 0;
static double *motion_ts = NULL;
static size_t motion_cap = 0, motion_n = 0;
enum { MAXD = 200000 };

/* ---- Self-declared XRecord ABI ----------------------------------------
 * This distro ships libXtst.so.6 but NOT X11/extensions/record.h, so the
 * XRecord API is declared here from the canonical X11 definitions. All
 * argument/field types are standard Xlib types, so the ABI is exact.
 * This program only TAPS the event stream (XRecord) -- it never grabs a
 * device, so it cannot disturb the running session. ------------------- */
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
/* Layout VERIFIED empirically against xrecord-validate.c / raw memory dump:
 *   off  0: unsigned long id
 *   off  8: int           category      (==4 for the first StartOfData event)
 *   off 12: Bool          server_time
 *   off 16: unsigned long client_seq
 *   off 24: unsigned long server_seq    (present on 64-bit)
 *   off 32: unsigned long data_len      (==0 for StartOfData)
 *   off 40: unsigned char *data
 * total 48 bytes. See input-16-rawdump.txt for the evidence. */
typedef struct {
    unsigned long id;
    int category;
    Bool server_time;
    unsigned long client_seq;
    unsigned long server_seq;
    unsigned long data_len;
    unsigned char *data;
} XRecordInterceptData;
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

#define XR_ALL_CLIENTS   3
#define XR_FROM_SERVER   0
#define XR_CATEGORY_SERVER 0

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

static void callback(XPointer cl, XRecordInterceptData *d) {
    (void)cl;
    if (!d) return;
    if (d->category != XR_CATEGORY_SERVER) { XRecordFreeData(d); return; }
    unsigned char *p = d->data;
    int type = p[0] & 0x7f;
    double t = now_s();
    if (t_first == 0) t_first = t;
    t_last = t;

    /* count only real delivered event data, skip Start/EndOfData markers */
    if (d->category != XR_CATEGORY_SERVER || d->data_len == 0 || d->data == NULL) {
        XRecordFreeData(d); return;
    }
    type = d->data[0] & 0x7f;

    switch (type) {
    case MotionNotify:
        n_motion++;
        if (motion_n < motion_cap) motion_ts[motion_n++] = t;
        break;
    case ButtonPress:
    case ButtonRelease:
        n_button++;
        break;
    case KeyPress:
    case KeyRelease:
        n_key++;
        break;
    default:
        n_other++;
        break;
    }
    XRecordFreeData(d);
}

int main(int argc, char **argv) {
    double secs = (argc > 1) ? atof(argv[1]) : 2.0;
    if (secs <= 0 || secs > 30) secs = 2.0;

    motion_cap = MAXD;
    motion_ts = calloc(motion_cap, sizeof(double));
    if (!motion_ts) { fprintf(stderr, "calloc failed\n"); return 2; }

    Display *dpy_ctrl = XOpenDisplay(NULL);
    if (!dpy_ctrl) { fprintf(stderr, "cannot open display\n"); return 2; }
    dpy_data = XOpenDisplay(NULL);
    if (!dpy_data) { fprintf(stderr, "cannot open 2nd display conn\n"); return 2; }

    int major = 0, minor = 0;
    if (!XRecordQueryVersion(dpy_ctrl, &major, &minor)) {
        fprintf(stderr, "XRecord not available\n"); return 3;
    }
    fprintf(stderr, "# XRecord version %d.%d, sampling %.2fs (layout: category@8 data_len@32 data@40)\n",
            major, minor, secs);

    XRecordRange *range = XRecordAllocRange();
    if (!range) { fprintf(stderr, "range alloc failed\n"); return 2; }
    memset(range, 0, sizeof(XRecordRange));
    range->deviceEventsFirst = KeyPress;
    range->deviceEventsLast  = MotionNotify;

    XRecordClientSpec cs = XR_ALL_CLIENTS;
    XRecordContext ctx = XRecordCreateContext(dpy_ctrl, 0, &cs, 1, &range, 1);
    if (!ctx) { fprintf(stderr, "XRecordCreateContext failed\n"); return 3; }

    XFlush(dpy_ctrl);
    /* Async so we fully control the duration without grabbing anything. */
    if (!XRecordEnableContextAsync(dpy_data, ctx, callback, NULL)) {
        fprintf(stderr, "XRecordEnableContextAsync failed\n"); return 3;
    }

    double t0 = now_s();
    while (now_s() - t0 < secs) {
        while (XPending(dpy_data)) XRecordProcessReplies(dpy_data);
        struct timespec ts = {0, 2000000};  /* 2ms */
        nanosleep(&ts, NULL);
    }
    /* drain */
    for (int i = 0; i < 50; i++) {
        while (XPending(dpy_data)) XRecordProcessReplies(dpy_data);
        struct timespec ts = {0, 1000000};
        nanosleep(&ts, NULL);
    }
    double elapsed = now_s() - t0;

    XRecordDisableContext(dpy_ctrl, ctx);
    XRecordFreeContext(dpy_ctrl, ctx);
    XFree(range);

    printf("elapsed_s=%.3f\n", elapsed);
    printf("motion_events=%lu  rate_hz=%.1f\n", n_motion, n_motion / elapsed);
    printf("button_events=%lu  rate_hz=%.1f\n", n_button, n_button / elapsed);
    printf("key_events=%lu  rate_hz=%.1f\n", n_key, n_key / elapsed);
    printf("other_events=%lu\n", n_other);
    printf("total_events=%lu  total_rate_hz=%.1f\n",
           n_motion + n_button + n_key + n_other,
           (n_motion + n_button + n_key + n_other) / elapsed);

    if (motion_n > 1) {
        double span = motion_ts[motion_n - 1] - motion_ts[0];
        /* inter-event gap histogram */
        double maxgap = 0, sumgap = 0;
        int gaps_lt_2ms = 0, gaps_2_5 = 0, gaps_5_10 = 0, gaps_gt_10 = 0;
        for (size_t i = 1; i < motion_n; i++) {
            double g = motion_ts[i] - motion_ts[i - 1];
            sumgap += g;
            if (g > maxgap) maxgap = g;
            if (g < 0.002) gaps_lt_2ms++;
            else if (g < 0.005) gaps_2_5++;
            else if (g < 0.010) gaps_5_10++;
            else gaps_gt_10++;
        }
        printf("motion_span_s=%.3f\n", span);
        printf("motion_burst_rate_hz=%.1f\n", (motion_n - 1) / span);
        printf("max_gap_ms=%.2f  mean_gap_ms=%.2f\n",
               maxgap * 1000, (sumgap / (motion_n - 1)) * 1000);
        printf("gap_hist: <2ms=%d  2-5ms=%d  5-10ms=%d  >10ms=%d\n",
               gaps_lt_2ms, gaps_2_5, gaps_5_10, gaps_gt_10);
    } else {
        printf("motion_gap_stats=INSUFFICIENT_MOTION\n");
    }
    return 0;
}
