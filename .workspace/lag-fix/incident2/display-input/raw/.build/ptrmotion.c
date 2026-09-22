/* Ground truth: does the pointer actually move during the window?
 * XQueryPointer is a plain read-only query - no grab, no events consumed. */
#include <X11/Xlib.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
int main(int argc,char**argv){
  double secs=argc>1?atof(argv[1]):5.0;
  Display*d=XOpenDisplay(NULL); if(!d){printf("no display\n");return 2;}
  Window r=DefaultRootWindow(d), cr,rr; int rx,ry,wx,wy; unsigned int m;
  int px,py; XQueryPointer(d,r,&rr,&cr,&rx,&ry,&wx,&wy,&m);
  px=rx;py=ry; long changes=0,samples=0,dist=0;
  struct timespec t0; clock_gettime(CLOCK_MONOTONIC,&t0); double s0=t0.tv_sec+t0.tv_nsec/1e9;
  int consecutive_static=0;
  for(;;){
    XQueryPointer(d,r,&rr,&cr,&rx,&ry,&wx,&wy,&m); samples++;
    if(rx!=px||ry!=py){ changes++; dist+=llabs((long)(rx-px))+llabs((long)(ry-py)); px=rx;py=ry; }
    struct timespec now; clock_gettime(CLOCK_MONOTONIC,&now);
    double el=(now.tv_sec+now.tv_nsec/1e9)-s0;
    if(el>secs) break;
    struct timespec sl={0,1000000}; nanosleep(&sl,NULL);
    (void)consecutive_static;
  }
  printf("poll_samples=%ld position_changes=%ld net_manhattan_dist=%ld\n", samples, changes, dist);
  printf("final_pos=%d,%d  pointer_moved=%s\n", px,py, changes?"YES":"NO");
  return changes?0:1;
}
