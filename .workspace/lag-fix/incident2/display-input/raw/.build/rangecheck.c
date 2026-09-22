#include <X11/Xlib.h>
#include <X11/Xmd.h>
#include <stdio.h>
typedef struct { CARD8 a,b,c,d,e,f; CARD16 g,h; CARD8 i,j; CARD16 k,l; CARD8 m,n,o,p,q,r; BOOL s,t; } R1;
typedef struct { CARD8 coreRequestsFirst, coreRequestsLast; CARD8 coreRepliesFirst, coreRepliesLast;
  CARD8 extRequestsMajorFirst, extRequestsMajorLast; CARD16 extRequestsMinorFirst, extRequestsMinorLast;
  CARD8 extRepliesMajorFirst, extRepliesMajorLast; CARD16 extRepliesMinorFirst, extRepliesMinorLast;
  CARD8 deliveredEventsFirst, deliveredEventsLast; CARD8 deviceEventsFirst, deviceEventsLast;
  CARD8 errorsFirst, errorsLast; BOOL clientStarted, clientDied; } R2;
#define O(s,f) printf("  %-22s offset=%2zu\n", #f, (size_t)((char*)&((s*)0)->f - (char*)0))
int main(void){
  printf("sizeof R1=%zu R2=%zu (sz_xRecordRange should be 24)\n", sizeof(R1), sizeof(R2));
  printf("R1 (shorthand names, used in dump.c):\n"); O(R1,m); O(R1,n);
  printf("R2 (verbose names, used in probes):\n"); O(R2,deviceEventsFirst); O(R2,deviceEventsLast);
  printf("MATCH: R1.m==R2.deviceEventsFirst -> %s\n",
    ((char*)&((R2*)0)->deviceEventsFirst-(char*)0)==((char*)&((R1*)0)->m-(char*)0) ? "YES":"NO");
  return 0;
}
