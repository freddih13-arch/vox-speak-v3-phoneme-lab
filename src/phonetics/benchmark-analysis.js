/** Technical benchmark utilities; NEVER interpret distances as quality scores. */
export const REFERENCE_TOKENS=Object.freeze({
  'I work in sales.':['aɪ','w','ɚ','k','ɪ','n','s','eɪ','l','z'],
  'I think this is important.':['aɪ','θ','ɪ','ŋ','k','ð','ɪ','s','ɪ','z','ɪ','m','p','ɔ','ɹ','t','ə','n','t'],
  'I achieved my sales targets.':['aɪ','ə','t͡ʃ','i','v','d','m','aɪ','s','eɪ','l','z','t','ɑ','ɹ','ɡ','ə','t','s'],
});
export const tokenize=ipa=>String(ipa).trim().split(/\s+/u).filter(Boolean);
/** Single token edit distance, independent of speech quality, no normalization. */
export function tokenEditDistance(expected,detected){
  const a=Array.from(expected),b=Array.from(detected),prev=Array.from({length:b.length+1},(_,i)=>i),curr=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    curr[0]=i;
    for(let j=1;j<=b.length;j++)curr[j]=Math.min(prev[j]+1,curr[j-1]+1,prev[j-1]+Number(a[i-1]!==b[j-1]));
    for(let j=0;j<=b.length;j++)prev[j]=curr[j];
  }
  return prev[b.length];
}
export const repeatedOutputsMatch=(first,second)=>first.ipaRaw===second.ipaRaw;
