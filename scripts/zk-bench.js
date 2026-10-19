// Proving benchmark: node scripts/zk-bench.js [votes]. Builds a random full round and proves it.
const nacl=require('tweetnacl');const bs58=(require('bs58').default||require('bs58'));
const {snapshot}=require('../lib/snapshot');const zk=require('../lib/zk');const {isqrt}=require('../lib/solana');
const n=Number(process.argv[2]||128);const votes={};const cands=Array.from({length:30},(_,i)=>({id:'c'+String(i).padStart(2,'0')}));
for(let i=0;i<n;i++){const w=bs58.encode(nacl.sign.keyPair().publicKey);const raw=BigInt(Math.floor(Math.random()*1e15));votes[w]={candidate:cands[i%5].id,message:'m',signature:'s',rawAtClose:raw.toString(),weightInt:isqrt(raw).toString()};}
const tot={};for(const v of Object.values(votes))tot[v.candidate]=(tot[v.candidate]||0n)+BigInt(v.weightInt);
const winner=Object.entries(tot).sort((a,b)=>(b[1]>a[1]?1:-1))[0][0];
const s=snapshot({cfg:{mint:'M',decimals:6,voteMin:1},round:42,bounds:{startsAt:1,endsAt:2},candidates:cands,votes,winner,house:false});
(async()=>{const t=Date.now();const r=await zk.prove(s.json);console.log(JSON.stringify({votes:n,status:r.status,proveMs:r.ms,totalMs:Date.now()-t,rssMB:Math.round(process.memoryUsage().rss/1048576)}));process.exit(0)})();
