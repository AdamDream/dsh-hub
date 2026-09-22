#include <X11/Xlib.h>
#include <X11/Xmd.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
typedef unsigned long XRecordContext, XRecordClientSpec;
typedef struct { CARD8 a,b,c,d,e,f; CARD16 g,h; CARD8 i,j; CARD16 k,l; CARD8 m,n,o,p,q,r; BOOL s,t; } XRecordRange;
typedef struct XRecordInterceptData XRecordInterceptData;
typedef void (*XRecordInterceptProc)(XPointer, XRecordInterceptData *);
extern Bool XRecordQueryVersion(Display*,int*,int*);
extern XRecordRange *XRecordAllocRange(void);
extern XRecordContext XRecordCreateContext(Display*,int,XRecordClientSpec*,int,XRecordRange**,int);
extern Status XRecordEnableContextAsync(Display*,XRecordContext,XRecordInterceptProc,XPointer);
extern void XRecordProcessReplies(Display*);
extern void XRecordDisableContext(Display*,XRecordContext);
extern void XRecordFreeContext(Display*,XRecordContext);
extern void XRecordFreeData(XRecordInterceptData*);
static int n=0;
static void cb(XPointer cl, XRecordInterceptData *d){
  (void)cl; if(!d) return;
  unsigned char *p=(unsigned char*)d;
  if(n<4){
    printf("event #%d raw 64 bytes:\n  ",n);
    for(int i=0;i<64;i++){ printf("%02x ",p[i]); if((i+1)%16==0) printf("\n  "); }
    printf("\n");
    /* interpret qwords */
    printf("  qwords:");
    for(int i=0;i<6;i++){ unsigned long v; memcpy(&v,p+i*8,8); printf(" [%d]=%lu",i,v); }
    printf("\n  dwords:");
    for(int i=0;i<12;i++){ unsigned int v; memcpy(&v,p+i*4,4); printf(" [%d]=%u",i,v); }
    printf("\n");
  }
  n++; XRecordFreeData(d);
}
int main(int argc,char**argv){
  double secs=argc>1?atof(argv[1]):1.0;
  Display*c=XOpenDisplay(NULL),*dd=XOpenDisplay(NULL);
  int maj,min; XRecordQueryVersion(c,&maj,&min);
  XRecordRange *r=XRecordAllocRange(); memset(r,0,sizeof(XRecordRange));
  r->m=KeyPress; r->n=MotionNotify;
  XRecordClientSpec cs=3; XRecordContext ctx=XRecordCreateContext(c,0,&cs,1,&r,1);
  XFlush(c); XRecordEnableContextAsync(dd,ctx,cb,NULL);
  struct timespec t0; clock_gettime(CLOCK_MONOTONIC,&t0); double s0=t0.tv_sec+t0.tv_nsec/1e9;
  while(1){ while(XPending(dd)) XRecordProcessReplies(dd);
    struct timespec now; clock_gettime(CLOCK_MONOTONIC,&now);
    if((now.tv_sec+now.tv_nsec/1e9)-s0>secs) break;
    struct timespec s={0,2000000}; nanosleep(&s,NULL);} 
  XRecordDisableContext(c,ctx); XRecordFreeContext(c,ctx);
  printf("total events=%d\n",n); return 0;
}
