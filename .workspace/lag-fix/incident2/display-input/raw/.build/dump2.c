/* Dump raw memory of every XRecord intercept struct, using the range fields
 * whose offsets were VERIFIED by .build/rangecheck.c (deviceEvents @18/19). */
#include <X11/Xlib.h>
#include <X11/Xmd.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
typedef unsigned long RC, RCS;
typedef struct { CARD8 coreRequestsFirst, coreRequestsLast, coreRepliesFirst, coreRepliesLast;
  CARD8 extRequestsMajorFirst, extRequestsMajorLast; CARD16 extRequestsMinorFirst, extRequestsMinorLast;
  CARD8 extRepliesMajorFirst, extRepliesMajorLast; CARD16 extRepliesMinorFirst, extRepliesMinorLast;
  CARD8 deliveredEventsFirst, deliveredEventsLast, deviceEventsFirst, deviceEventsLast;
  CARD8 errorsFirst, errorsLast; BOOL clientStarted, clientDied; } XRecordRange;
typedef struct XRecordInterceptData XRecordInterceptData;
typedef void (*XRecordInterceptProc)(XPointer, XRecordInterceptData *);
extern Bool XRecordQueryVersion(Display*,int*,int*);
extern XRecordRange *XRecordAllocRange(void);
extern RC XRecordCreateContext(Display*,int,RCS*,int,XRecordRange**,int);
extern Status XRecordEnableContextAsync(Display*,RC,XRecordInterceptProc,XPointer);
extern void XRecordProcessReplies(Display*);
extern void XRecordDisableContext(Display*,RC);
extern void XRecordFreeContext(Display*,RC);
extern void XRecordFreeData(XRecordInterceptData*);
static long n=0, shown=0;
static void cb(XPointer cl, XRecordInterceptData *d){
  (void)cl; if(!d) return;
  unsigned char *p=(unsigned char*)d;
  if(shown<4 && n<400){
    printf("EVENT #%ld raw 48B: ", n);
    for(int i=0;i<48;i++) printf("%02x ", p[i]);
    printf("\n");
    unsigned long q[6]; for(int i=0;i<6;i++) memcpy(&q[i],p+i*8,8);
    printf("   qwords: id=%lu cat=%lu cliseq=%lu srvseq=%lu len=%lu ptr=%lu\n",q[0],q[1],q[2],q[3],q[4],q[5]);
    shown++;
  }
  n++; XRecordFreeData(d);
}
int main(int argc,char**argv){
  double secs=argc>1?atof(argv[1]):3.0;
  Display*c=XOpenDisplay(NULL),*dd=XOpenDisplay(NULL);
  if(!c||!dd){printf("no display\n");return 2;}
  int maj,min; XRecordQueryVersion(c,&maj,&min);
  XRecordRange *r=XRecordAllocRange(); memset(r,0,sizeof(XRecordRange));
  r->deviceEventsFirst=2; r->deviceEventsLast=6;
  r->deliveredEventsFirst=2; r->deliveredEventsLast=6;
  printf("range: device[%d..%d] delivered[%d..%d]\n", r->deviceEventsFirst, r->deviceEventsLast, r->deliveredEventsFirst, r->deliveredEventsLast);
  RCS cs = (argc>2 && argv[2][0]=='f') ? 2 : 1;  /* 1=CurrentClients 2=FutureClients 3=All */ RC ctx=XRecordCreateContext(c,0,&cs,1,&r,1);
  printf("clientSpec=%lu ctx=%lu\n",cs,ctx); if(!ctx) return 3;
  XFlush(c); XRecordEnableContextAsync(dd,ctx,cb,NULL);
  struct timespec t0; clock_gettime(CLOCK_MONOTONIC,&t0); double s0=t0.tv_sec+t0.tv_nsec/1e9;
  for(;;){ while(XPending(dd)) XRecordProcessReplies(dd);
    struct timespec now; clock_gettime(CLOCK_MONOTONIC,&now);
    if((now.tv_sec+now.tv_nsec/1e9)-s0>secs) break;
    struct timespec s={0,1000000}; nanosleep(&s,NULL);}
  XRecordDisableContext(c,ctx); XRecordFreeContext(c,ctx);
  printf("total intercept events=%ld\n",n); return 0;
}
