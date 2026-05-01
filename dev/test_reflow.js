const code = `#include <bits/stdc++.h>using namespace std;#define fastio() ios_base::sync_with_stdio(false);cin.tie(NULL);cout.tie(NULL)#define int long long\u00a0signed main(){    fastio();    int t;cin>>t;    while(t--){        int a,b;cin>>a>>b;        int ans=0;\u00a0        {            int x=a,y=b,need=1,c=0;            int f=1;            while(1){                if(f){                    if(x<need)break;                    x-=need;                }else{                    if(y<need)break;                    y-=need;                }                c++;                need*=2;                f^=1;            }            ans=max(ans,c);        }\u00a0        {            int x=a,y=b,need=1,c=0;            int f=0;            while(1){                if(f){                    if(x<need)break;                    x-=need;                }else{                    if(y<need)break;                    y-=need;                }                c++;                need*=2;                f^=1;            }            ans=max(ans,c);        }\u00a0        cout<<max(ans,1LL)<<"\\n";    }    return 0;}`;

let s = code;
// normalize CRLF
s = s.replace(/\r\n/g, "\n");
// if no real newline and contains \n, do not convert (we'll avoid converting string literal escapes)
// attempt JSON array parse (skip)
// Heuristic: if no newlines and long, and looks like C++
const newlineCount = (s.match(/\n/g) || []).length;
console.log("initial newlines:", newlineCount);
if (newlineCount === 0 && s.length > 180) {
  // Use the same reflow algorithm as in background.js
  function reflowCode(src) {
    let out = "";
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];

      if (!escaped) {
        if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
        else if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
        else if (ch === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;
      }

      if (ch === "\\" && !escaped) {
        escaped = true;
        out += ch;
        continue;
      }

      if (!inSingle && !inDouble && !inBacktick && ch === ";") {
        out += ";\n";
        escaped = false;
        continue;
      }

      if (!inSingle && !inDouble && !inBacktick && ch === "{") {
        if (out.length && out.slice(-1) !== "\n") out += "\n";
        out += "{\n";
        escaped = false;
        continue;
      }

      if (!inSingle && !inDouble && !inBacktick && ch === "}") {
        if (out.length && out.slice(-1) !== "\n") out += "\n";
        out += "}\n";
        escaped = false;
        continue;
      }

      out += ch;
      if (escaped) escaped = false;
    }

    out = out.replace(/\s*#include/g, "\n#include");
    out = out.replace(/\s*#define/g, "\n#define");
    out = out.replace(/\s*using\s+namespace/g, "\nusing namespace");
    return out;
  }

  s = reflowCode(s);
  console.log("applied reflowCode");
}

console.log("after newlines:", (s.match(/\n/g) || []).length);
console.log("--- result ---");
console.log(s);
