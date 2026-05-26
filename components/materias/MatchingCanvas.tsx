'use client';

import { useMemo, useState } from 'react';

export default function MatchingCanvas({
pairs,
value,
onChange,
locked=false,
themeColor='#22d3ee'
}:any){

const [selectedLeft,setSelectedLeft]=useState<number|null>(null);

const connections=value||{};

const connect=(left:number,right:number)=>{

if(locked) return;

const next={...connections};

Object.keys(next).forEach(k=>{
if(next[k]===right){
delete next[k];
}
});

next[left]=right;

onChange(next);

setSelectedLeft(null);
};

const correctCount=useMemo(()=>{

let ok=0;

pairs?.forEach((p:any,i:number)=>{

const expected=i;
const got=connections[i];

if(got===expected) ok++;

});

return ok;

},[pairs,connections]);

return(

<div style={{
display:'grid',
gridTemplateColumns:'1fr 120px 1fr',
gap:20,
position:'relative'
}}>

<div style={{
display:'flex',
flexDirection:'column',
gap:12
}}>

{pairs?.map((p:any,i:number)=>(

<button
key={i}
onClick={()=>setSelectedLeft(i)}
style={{
padding:'14px',
borderRadius:14,
border:selectedLeft===i
?`2px solid ${themeColor}`
:'2px solid rgba(255,255,255,.08)',
background:selectedLeft===i
?`${themeColor}22`
:'rgba(255,255,255,.03)',
color:'#fff'
}}
>

{p.left}

</button>

))}

</div>

<div style={{
display:'flex',
alignItems:'center',
justifyContent:'center',
fontWeight:700,
color:themeColor
}}>

{correctCount}/{pairs?.length||0}

</div>

<div style={{
display:'flex',
flexDirection:'column',
gap:12
}}>

{pairs?.map((p:any,i:number)=>(

<button
key={i}
onClick={()=>
selectedLeft!==null &&
connect(
selectedLeft,
i
)
}
style={{
padding:'14px',
borderRadius:14,
border:'2px solid rgba(255,255,255,.08)',
background:'rgba(255,255,255,.03)',
color:'#fff'
}}
>

{p.right}

</button>

))}

</div>

</div>

);

}
