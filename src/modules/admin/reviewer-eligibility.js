// Capacity warnings only. Record-specific approval services remain authoritative.
export const reviewWorkflows = [
  { key:'quotations',label:'Quotations',maker:[['quotations.create'],['quotations.update']],reviewer:[['quotations.read','quotations.approve']] },
  { key:'orders',label:'Sales orders',maker:[['orders.create'],['orders.update']],reviewer:[['orders.read','orders.review']] },
  { key:'purchasing',label:'Supplier POs and documents',maker:[['purchasing.write']],reviewer:[['purchasing.read','purchasing.write','purchasing.approve']] },
  { key:'grn',label:'Goods received notes',maker:[['purchasing.write'],['logistics.grn.manage']],reviewer:[['purchasing.read','purchasing.write','purchasing.approve'],['logistics.grn.read','logistics.grn.post']] },
  { key:'contracts',label:'Rate contracts',maker:[['contracts.manage']],reviewer:[['contracts.approve']] },
  { key:'operations',label:'Operational cases',maker:[['operations.write']],reviewer:[['operations.read','operations.approve']] },
  { key:'collections',label:'Financial cases',maker:[['collections.write']],reviewer:[['collections.read','collections.approve']],financial:true },
  { key:'exceptions',label:'Exceptions',maker:[['exceptions.raise']],reviewer:[['exceptions.decide']] }
];
const available = u => u.status === 'ACTIVE' && !(u.on_leave ?? u.onLeave);
const permitted = (u, alternatives, access) => alternatives.some(keys=>keys.every(key=>access.can(u,key)));
export function eligibleReviewers(users, access, workflow, { makerId,editorId,excludedIds=[],now=Date.now() }={}) {
  const spec=reviewWorkflows.find(w=>w.key===workflow);
  if(!spec)throw new Error('Unknown review workflow.');
  const blocked=new Set([makerId,editorId,...excludedIds].filter(id=>id!=null).map(String));
  return users.filter(u=>available(u) && !blocked.has(String(u.id)) &&
    [0,false].includes(u.must_change_password ?? u.mustChangePassword) && (!u.locked_until || Date.parse(u.locked_until)<=now) &&
    (!access.requiresMfa(u.role) || (u.mfa_enabled ?? u.mfaEnabled)) &&
    (!spec.financial || ['OWNER','ACCOUNTS'].includes(u.role)) && permitted(u,spec.reviewer,access));
}
export function provisioningWarnings(users,access) {
  const activeOwnerCount=users.filter(u=>u.role==='OWNER'&&u.status==='ACTIVE').length;
  const warnings=[];
  if(activeOwnerCount<=1)warnings.push({code:'SINGLE_OWNER',message:activeOwnerCount===1?'Only one active Owner exists. They cannot be deactivated or demoted.':'No active Owner exists. Owner access must be restored.'});
  const workflows=reviewWorkflows.map(w=>{
    const makers=users.filter(u=>available(u)&&(!w.financial||['OWNER','ACCOUNTS'].includes(u.role))&&permitted(u,w.maker,access));
    const withoutReviewer=makers.filter(m=>eligibleReviewers(users,access,w.key,{makerId:m.id}).length===0).map(m=>({id:m.id,name:m.name}));
    if(withoutReviewer.length)warnings.push({code:'NO_INDEPENDENT_REVIEWER',workflow:w.key,message:`${w.label}: no independent, ready reviewer for ${withoutReviewer.map(u=>u.name).join(', ')}.`,makers:withoutReviewer});
    return {key:w.key,label:w.label,readyReviewerCount:eligibleReviewers(users,access,w.key).length,makersWithoutReviewer:withoutReviewer};
  });
  return {activeOwnerCount,warnings,workflows};
}
