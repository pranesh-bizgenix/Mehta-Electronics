import { Tabs } from './ui-components.js?v=1';
let ui;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={kind:'customers',page:1,search:'',status:'',owner:'',source:'',from:'',to:''};
const esc=v=>ui.esc(v),dash=v=>v==null||v===''?'—':esc(v);
const value=(form,key)=>new FormData(form).get(key)?.toString().trim()||'';
const field=(label,key,type='text',v='',extra='')=>`<label>${label}<input name="${key}" type="${type}" value="${esc(v??'')}" ${extra}></label>`;
const select=(label,key,values,v='')=>`<label>${label}<select name="${key}">${values.map(([id,name])=>`<option value="${esc(id)}" ${String(id)===String(v)?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
const badge=v=>`<span class="status">${esc(v||'—')}</span>`;
const busy=()=>{$('#view').innerHTML='<div class="loading-grid" role="status" aria-label="Loading CRM"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';};
const actions=(...buttons)=>`<div class="detail-actions">${buttons.join('')}</div>`;
let version=0;
export function configureCrmModules(context){ui=context;}
const permissions=kind=>kind==='price-lists'?'items':kind;
export const loadCrmCustomers=()=>loadList('customers');
export const loadCrmItems=()=>loadList('items');
export const loadCrmEnquiries=()=>loadList('enquiries');
function failure(error,retry){$('#view').innerHTML=`<section class="feedback-error" role="alert"><h2>CRM view unavailable</h2><p>${esc(error.message)}</p><button id="crm-retry" class="secondary">Try again</button></section>`;$('#crm-retry').onclick=retry;}
async function loadList(kind,keep=false){
  if(!keep||state.kind!==kind){Object.assign(state,{kind,page:1,search:'',status:'',owner:'',source:'',from:'',to:''});}
  const token=++version;busy();
  try{
    const params=new URLSearchParams({page:state.page,search:state.search,status:state.status});
    if(state.from)params.set('from',state.from);if(state.to)params.set('to',state.to);if(state.owner)params.set('ownerId',state.owner);if(state.source)params.set('source',state.source);
    const result=await ui.api(`/api/crm/${kind}?${params}`);if(token!==version||ui.currentView()!==kind)return;
    const owners=kind==='enquiries'?(await ui.api('/api/crm/owners')).data:[];
    if(token!==version||ui.currentView()!==kind)return;
    const labels={customers:'Customers',items:'Items',enquiries:'Enquiries'},statuses=kind==='customers'?['ACTIVE','INACTIVE','ON_HOLD']:kind==='items'?['ACTIVE','INACTIVE','SUPERSEDED']:['NEW','QUALIFIED','QUOTED','WON','LOST','CANCELLED'];
    const columns=kind==='customers'?['Customer','Tally link','GSTIN','Credit limit','Terms','Status','']:kind==='items'?['Part number','Description','Tally link','HSN / UOM','Pack size','Status','']:['Enquiry','Customer','Owner','Source','Expected by','Status',''];
    const rows=result.data.map(row=>`<tr>${(kind==='customers'?[esc(row.name),badge(row.tally_linked?'Tally linked':'CRM only'),dash(row.gstin),dash(row.credit_limit),esc(row.payment_terms||`${row.credit_days} days`),badge(row.status)]:kind==='items'?[esc(row.part_code),esc(row.description),badge(row.tally_linked?'Tally linked':'CRM only'),`${dash(row.hsn)} / ${esc(row.uom)}`,dash(row.pack_size),badge(row.status)]:[esc(row.enquiry_number),esc(row.customer_name),dash(row.owner_name),dash(row.source),dash(row.expected_by),badge(row.status)]).map(cell=>`<td>${cell}</td>`).join('')}<td><button class="link crm-detail" data-id="${row.id}">View</button></td></tr>`).join('');
    $('#view').innerHTML=`<section class="panel"><div class="toolbar"><div class="filters"><label>Search<input id="crm-search" type="search" value="${esc(state.search)}" placeholder="Search ${kind}"></label>${select('Status','listStatus',[['','All statuses'],...statuses.map(v=>[v,v])],state.status)}${kind==='enquiries'?select('Owner','listOwner',[['','All owners'],...owners.map(o=>[o.id,o.name])],state.owner)+field('Source','listSource','text',state.source)+field('Expected from','listFrom','date',state.from)+field('Expected to','listTo','date',state.to):''}<button id="crm-go" class="secondary">Apply filters</button></div>${kind!=='enquiries'?'<button id="crm-saved" class="secondary">Saved Tally</button>':''}${kind==='items'?'<button id="crm-prices" class="secondary">Price lists</button>':''}${ui.allowed(`${kind}.create`)?`<button id="crm-new" class="primary">New ${kind==='enquiries'?'enquiry':kind==='customers'?'customer':'item'}</button>`:''}</div><p class="muted">${labels[kind]} managed in CRM. Tally balances and stock remain read-only.</p><div class="table-wrap"><table><thead><tr>${columns.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td class="empty" colspan="7">No ${kind} match your filters. Create a record or change the filters.</td></tr>`}</tbody></table></div><div class="pager"><button id="crm-prev" ${result.pagination.page<=1?'disabled':''}>Previous</button><span>Page ${result.pagination.page} / ${Math.max(1,result.pagination.pages)} · ${result.pagination.total} records</span><button id="crm-next" ${result.pagination.page>=result.pagination.pages?'disabled':''}>Next</button></div></section>`;
    const apply=()=>{state.search=$('#crm-search').value;state.status=$('[name=listStatus]').value;state.owner=$('[name=listOwner]')?.value||'';state.source=$('[name=listSource]')?.value||'';state.from=$('[name=listFrom]')?.value||'';state.to=$('[name=listTo]')?.value||'';state.page=1;loadList(kind,true);};
    $('#crm-go').onclick=apply;$('#crm-search').onkeydown=e=>{if(e.key==='Enter')apply();};
    $('#crm-prev').onclick=()=>{state.page--;loadList(kind,true);};$('#crm-next').onclick=()=>{state.page++;loadList(kind,true);};
    $('#crm-saved')?.addEventListener('click',()=>ui.saved(kind));$('#crm-prices')?.addEventListener('click',loadPriceLists);
    $('#crm-new')?.addEventListener('click',()=>kind==='enquiries'?enquiryForm():masterForm(kind));
    $$('.crm-detail').forEach(button=>button.onclick=()=>detail(kind,button.dataset.id));
  }catch(error){if(token===version)failure(error,()=>loadList(kind,true));}
}
function tabs(labels,onSelect){
  const root=$('#crm-tabs');new Tabs(root);
  const run=()=>onSelect($('[role=tab][aria-selected=true]').dataset.tab);
  root.addEventListener('click',event=>{if(event.target.closest('[role=tab]'))run();});
  root.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))run();});run();
}
const tabMarkup=labels=>`<div id="crm-tabs">${labels.map(([key,label],i)=>`<button type="button" role="tab" id="tab-${key}" data-tab="${key}" aria-controls="panel-${key}" aria-selected="${i===0}">${label}</button>`).join('')}</div>${labels.map(([key])=>`<section id="panel-${key}" role="tabpanel" aria-labelledby="tab-${key}" class="crm-tab-panel"></section>`).join('')}`;
async function detail(kind,recordId){
  const token=++version;busy();
  try{
    const record=(await ui.api(`/api/crm/${kind}/${recordId}`)).data;if(token!==version||ui.currentView()!==kind)return;
    const title=record.name||record.part_code||record.enquiry_number;
    const labels=kind==='customers'?[['overview','Overview'],['contacts','Contacts'],['parts','Customer part numbers'],['enquiries','Enquiries'],['quotes','Quotes'],['orders','Orders'],['invoices','Invoices'],['dues','Dues']]:kind==='items'?[['overview','Overview'],['stock','Tally stock'],['prices','Price lists']]:[['overview','Enquiry'],['history','Revision history']];
    $('#view').innerHTML=`<section class="panel"><header><div><p class="eyebrow">CRM / ${esc(kind)}</p><h2>${esc(title)}</h2></div>${badge(record.status)}</header>${actions('<button class="secondary" id="crm-back">Back to list</button>',ui.allowed(`${permissions(kind)}.update`)&&(kind!=='enquiries'||['NEW','QUALIFIED'].includes(record.status))?'<button id="crm-edit" class="primary">Edit</button>':'')}${tabMarkup(labels)}</section>`;
    $('#crm-back').onclick=()=>loadList(kind,true);$('#crm-edit')?.addEventListener('click',()=>kind==='enquiries'?enquiryForm(record):masterForm(kind,record));
    const render=async key=>{
      const panel=$(`#panel-${key}`);panel.innerHTML='<p class="muted" role="status">Loading details…</p>';
      try{
        if(kind==='customers'){
          if(key==='overview')panel.innerHTML=`<div class="detail-grid">${[['GSTIN',record.gstin],['State code',record.profile.state_code],['Payment terms',record.profile.payment_terms],['Credit limit',record.credit_limit],['Credit days',record.credit_days],['Tally ledger',record.tally.name],['Link status',record.tally.linked?'Tally linked':record.tally.matchCount>1?'Ambiguous link':'CRM only']].map(([l,v])=>`<div><span>${l}</span><strong>${dash(v)}</strong></div>`).join('')}</div>`;
          else if(key==='contacts')panel.innerHTML=`<p class="muted">Edit the customer to manage contacts. Removed contacts are archived with your edit reason.</p>${simpleTable(['Name','Designation','Phone','Email','Primary'],record.contacts.map(c=>[c.name,c.designation,c.phone,c.email,c.is_primary?'Yes':'No']))}`;
          else if(key==='parts'){
            panel.innerHTML=`${ui.allowed('customers.update')?'<button id="new-part-mapping" class="secondary">Add customer part number</button>':''}${simpleTable(['Customer part number','CRM item','Status',''],record.partMappings.map(m=>[m.customer_part_number,m.part_code,m.status,{html:ui.allowed('customers.update')?`<button class="link edit-mapping" data-id="${m.id}">Edit</button>`:''}]))}`;
            $('#new-part-mapping')?.addEventListener('click',()=>partForm(record));$$('.edit-mapping').forEach(b=>b.onclick=()=>partForm(record,record.partMappings.find(m=>String(m.id)===b.dataset.id)));
          }else{
            const result=await ui.api(`/api/crm/customers/${recordId}/history/${key}`);
            if(!panel.isConnected)return;
            if(key==='dues')panel.innerHTML=dues(result.data);
            else panel.innerHTML=result.available===false?`<div class="empty">${esc(result.reason)}</div>`:simpleTable(['Number','Status','Created'],result.data.map(r=>[r.number,r.status,r.created_at]));
          }
        }else if(kind==='items'){
          if(key==='overview')panel.innerHTML=`<div class="detail-grid">${[['Part number',record.part_code],['Description',record.description],['HSN',record.hsn],['UOM',record.uom],['Pack size',record.pack_size],['MOQ',record.profile.moq||1],['List price',record.profile.list_price??0],['Default discount %',record.profile.discount_percent??0]].map(([l,v])=>`<div><span>${l}</span><strong>${dash(v)}</strong></div>`).join('')}</div>`;
          if(key==='stock')panel.innerHTML=`<p class="muted">${esc(record.stock.note)}</p>${record.stock.linked?simpleTable(['Tally item','Quantity as delivered','Rate as delivered','Value as delivered','Fetched'],[[record.stock.name,record.stock.closing_quantity_text,record.stock.closing_rate_text,record.stock.closing_value,record.stock.fetched_at]]):'<div class="empty">No unique Tally stock link. Edit the CRM item to select an exact stored name.</div>'}`;
          if(key==='prices'){panel.innerHTML=`<p class="muted">Explicit list and tier discounts are shown separately. No automatic quotation repricing or discount stacking is applied.</p><button id="manage-price-lists" class="secondary">Manage price lists</button>${simpleTable(['List','Currency','From','To','Minimum qty','Unit price','List discount %','Tier discount %'],record.prices.map(p=>[p.list_name,p.currency,p.effective_from,p.effective_to,p.min_quantity,p.unit_price,p.list_discount,p.discount_percent]))}`;$('#manage-price-lists').onclick=loadPriceLists;}
        }else if(key==='overview'){
          panel.innerHTML=`<div class="detail-grid">${[['Customer',record.customer_name],['Owner',record.assigned_name],['Source',record.source],['Expected by',record.expected_by],['Notes',record.notes]].map(([l,v])=>`<div><span>${l}</span><strong>${dash(v)}</strong></div>`).join('')}</div>${simpleTable(['Item','Description','Quantity','UOM'],record.lines.map(l=>[l.part_code,l.description,l.quantity,l.uom]))}${actions(...(ui.allowed('enquiries.update')?({NEW:['QUOTED'],QUALIFIED:['QUOTED','LOST'],QUOTED:['WON','LOST']}[record.status]||[]).map(s=>`<button class="secondary crm-transition" data-status="${s}">Mark ${s.toLowerCase()}</button>`):[]),ui.allowed('quotations.create')&&!['WON','LOST','CANCELLED'].includes(record.status)?'<button class="primary" id="crm-quote">Create quotation</button>':'')}`;
          $$('.crm-transition').forEach(b=>b.onclick=()=>statusForm(record,b.dataset.status));$('#crm-quote')?.addEventListener('click',()=>ui.quote(record));
        }else{const result=await ui.api(`/api/enquiries/${recordId}/revisions`);if(panel.isConnected)panel.innerHTML=simpleTable(['Revision','Reason','Author','Created'],result.data.map(r=>[r.revision_number,r.reason,r.created_by_name,r.created_at]));}
      }catch(error){if(panel.isConnected)panel.innerHTML=`<p class="error" role="alert">${esc(error.message)}</p>`;}
    };
    tabs(labels,render);
  }catch(error){if(token===version)failure(error,()=>detail(kind,recordId));}
}
function simpleTable(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell&&typeof cell==='object'&&'html'in cell?cell.html:dash(cell)}</td>`).join('')}</tr>`).join('')||`<tr><td class="empty" colspan="${headers.length}">No records yet.</td></tr>`}</tbody></table></div>`;}
function dues(data){return `<p class="muted">${esc(data.note)}</p>${data.available?`<article class="stock-coverage"><strong>Signed closing balance: ${esc(data.closingBalance)}</strong><span>Dr/Cr: ${dash(data.drCr)} · Fetched: ${dash(data.fetchedAt)}</span><small>Read only. No CRM edit can change this balance.</small></article>`:`<div class="empty">${data.financialAccess?'No unique ledger link or closing balance is available.':'Your role does not have access to Tally balances.'}</div>`}`;}
async function masterForm(kind,record=null){
  try{
    const companies=(await ui.api('/api/tally/read-companies')).data,p=record?.profile||{},customer=kind==='customers';
    const link=p[customer?'tally_ledger_name':'tally_stock_name']||'';
    const common=customer?field('Customer name','name','text',record?.name,'required')+field('Customer code','customerCode','text',record?.customer_code)+field('GSTIN','gstin','text',record?.gstin,'maxlength="15"')+field('State code','stateCode','text',p.state_code,'maxlength="2" pattern="[0-9]{2}"')+field('Payment terms','paymentTerms','text',p.payment_terms)+field('Credit days','creditDays','number',record?.credit_days??0,'min="0" max="3650" step="1"')+field('Credit limit','creditLimit','number',record?.credit_limit??0,'min="0" step="0.000001"')+`<label class="wide">Billing address<textarea name="billingAddress">${esc(record?.billing_address||'')}</textarea></label>`:
      field('Part number','partCode','text',record?.part_code,'required')+field('Description','description','text',record?.description,'required')+field('HSN','hsn','text',record?.hsn)+field('UOM','uom','text',record?.uom,'required')+field('Pack size','packSize','number',record?.pack_size??1,'required min="0.000001" step="0.000001"')+field('MOQ','moq','number',p.moq??1,'required min="0.000001" step="0.000001"')+field('List price','listPrice','number',p.list_price??0,'required min="0" step="0.000001"')+field('Default discount %','discountPercent','number',p.discount_percent??0,'required min="0" max="100" step="0.000001"');
    ui.openModal(`${record?'Edit':'New'} ${customer?'customer':'item'}`,`<div class="form-grid">${common}${select('Status','status',(customer?['ACTIVE','INACTIVE','ON_HOLD']:['ACTIVE','INACTIVE','SUPERSEDED']).map(s=>[s,s]),record?.status||'ACTIVE')}${select('Tally company','companyId',[['','No Tally link'],...companies.map(c=>[c.id,c.display_name||c.name])],p.company_id||'')}${field('Exact stored Tally name','tallyName','text',link)}<div class="wide"><button type="button" id="find-tally" class="secondary">Find stored Tally record</button><select id="tally-matches" aria-label="Stored Tally search results"><option value="">Search by the exact-name field above</option></select><p class="muted">Mapping only. Clear company and name together to unlink; no stored Tally data is changed.</p></div>${customer?'<div class="wide"><h3>Contacts</h3><div id="crm-contacts"></div><button id="add-contact" type="button" class="secondary">Add contact</button></div>':''}${field(record?'Edit reason':'Notes / reason','reason','text','',''+(record?'required':''))}</div>`,async form=>{
      const keys=customer?['name','customerCode','gstin','stateCode','paymentTerms','creditDays','creditLimit','billingAddress']:['partCode','description','hsn','uom','packSize','moq','listPrice','discountPercent'];
      const body=Object.fromEntries([...keys,'status','companyId','tallyName','reason'].map(k=>[k,value(form,k)]));body.tallyName=new FormData(form).get('tallyName')?.toString()||'';
      if(customer)body.contacts=[...form.querySelectorAll('.crm-contact-row')].map(row=>({id:row.dataset.id||undefined,name:row.querySelector('[name=contactName]').value,designation:row.querySelector('[name=designation]').value,phone:row.querySelector('[name=phone]').value,email:row.querySelector('[name=email]').value,isPrimary:row.querySelector('[name=isPrimary]').checked}));
      await saveModal(`/api/crm/${kind}${record?'/'+record.id:''}`,record?'PATCH':'POST',body,result=>detail(kind,result.id));
    });
    if(customer){record?.contacts.forEach(c=>addContact(c));$('#add-contact').onclick=()=>addContact();}
    $('#find-tally').onclick=async()=>{try{const company=$('[name=companyId]').value;if(!company)throw new Error('Select an imported company first.');const search=$('[name=tallyName]').value;const result=await ui.api(`/api/tally/${customer?'customers':'items'}?companyId=${encodeURIComponent(company)}&search=${encodeURIComponent(search)}&pageSize=100`);$('#tally-matches').innerHTML='<option value="">Select a stored name</option>'+result.data.map(r=>`<option value="${esc(r.name)}">${esc(r.display_name||r.name)}</option>`).join('');}catch(error){ui.toast(error.message,true);}};
    $('#tally-matches').onchange=e=>{if(e.target.value)$('[name=tallyName]').value=e.target.value;};
  }catch(error){ui.toast(error.message,true);}
}
function addContact(contact={}){
  const row=document.createElement('div');row.className='crm-contact-row';if(contact.id)row.dataset.id=contact.id;
  row.innerHTML=`${field('Name','contactName','text',contact.name,'required')}${field('Designation','designation','text',contact.designation)}${field('Phone','phone','tel',contact.phone)}${field('Email','email','email',contact.email)}<label class="check-field"><input name="isPrimary" type="checkbox" ${contact.is_primary?'checked':''}> Primary contact</label><button type="button" class="secondary archive-contact">${contact.id?'Archive contact':'Remove unsaved contact'}</button>`;
  row.querySelector('button').onclick=()=>row.remove();$('#crm-contacts').append(row);
}
async function saveModal(url,method,body,next){
  const save=$('#modal-save');if(save.disabled)return;save.disabled=true;save.setAttribute('aria-busy','true');
  try{const response=await ui.api(url,{method,body:JSON.stringify(body)});$('#modal').close();ui.toast('Saved with an audit entry.');next(response.data);}catch(error){ui.toast(error.message,true);}finally{save.disabled=false;save.removeAttribute('aria-busy');}
}
async function lookup(root,kind,selected,selectedLabel){
  const search=root.querySelector('[data-lookup-search]'),select=root.querySelector('select');
  const run=async()=>{try{const result=await ui.api(`/api/crm/${kind}?status=ACTIVE&pageSize=100&search=${encodeURIComponent(search.value)}`);select.innerHTML='<option value="">Select a record</option>'+result.data.map(r=>`<option value="${r.id}">${esc(r.name||r.part_code)}</option>`).join('');if(selected&&!result.data.some(r=>String(r.id)===String(selected)))select.add(new Option(selectedLabel||`Selected record ${selected}`,selected));if(selected)select.value=selected;}catch(error){ui.toast(error.message,true);}};
  root.querySelector('button').onclick=run;await run();
}
const lookupHtml=(label,name)=>`<div class="crm-lookup"><label>${label}<select name="${name}" required><option value="">Loading…</option></select></label><input data-lookup-search type="search" placeholder="Search ${label.toLowerCase()}" aria-label="Search ${label}"><button type="button" class="secondary">Find</button></div>`;
async function partForm(customer,mapping=null){
  ui.openModal(mapping?'Edit customer part number':'Add customer part number',`<div class="form-grid"><div class="wide" id="mapping-item">${lookupHtml('Item','itemId')}</div>${field('Customer part number','customerPartNumber','text',mapping?.customer_part_number,'required')}${select('Status','status',['ACTIVE','INACTIVE','ARCHIVED'].map(s=>[s,s]),mapping?.status||'ACTIVE')}${field('Reason','reason','text','','required')}</div>`,form=>saveModal(`/api/crm/customers/${customer.id}/part-mappings${mapping?'/'+mapping.id:''}`,mapping?'PATCH':'POST',{itemId:value(form,'itemId'),customerPartNumber:value(form,'customerPartNumber'),status:value(form,'status'),reason:value(form,'reason')},()=>detail('customers',customer.id)));
  await lookup($('#mapping-item'),'items',mapping?.item_id,mapping?.part_code);
}
async function enquiryForm(record=null){
  try{
    const owners=(await ui.api('/api/crm/owners')).data;
    ui.openModal(record?'Edit enquiry':'New enquiry',`<div class="form-grid"><div class="wide" id="enquiry-customer">${lookupHtml('Customer','customerId')}</div>${field('Subject','subject','text',record?.subject,'required')}${field('Source','source','text',record?.source||'Direct')}${field('Expected by','expectedBy','date',record?.expected_by)}${select('Owner','ownerId',owners.map(o=>[o.id,o.name]),record?.assigned_to||ui.userId())}<label class="wide">Notes<textarea name="notes">${esc(record?.notes||'')}</textarea></label><div class="wide"><h3>Requested items</h3><div id="crm-enquiry-lines"></div><button type="button" id="add-enquiry-item" class="secondary">Add item</button></div>${field('Reason','reason','text','',''+(record?'required':''))}</div>`,form=>saveModal(`/api/crm/enquiries${record?'/'+record.id:''}`,record?'PUT':'POST',{customerId:value(form,'customerId'),subject:value(form,'subject'),source:value(form,'source'),expectedBy:value(form,'expectedBy'),ownerId:value(form,'ownerId'),notes:value(form,'notes'),reason:value(form,'reason'),lines:[...form.querySelectorAll('.crm-enquiry-line')].map(row=>({itemId:row.querySelector('select').value,quantity:row.querySelector('[name=quantity]').value}))},result=>detail('enquiries',result.id)));
    await lookup($('#enquiry-customer'),'customers',record?.customer_id,record?.customer_name);
    for(const line of record?.lines||[{}])await addEnquiryLine(line);
    $('#add-enquiry-item').onclick=()=>addEnquiryLine();
  }catch(error){ui.toast(error.message,true);}
}
async function addEnquiryLine(line={}){
  const row=document.createElement('div');row.className='crm-enquiry-line';row.innerHTML=`${lookupHtml('Item','lineItem')}${field('Quantity','quantity','number',line.quantity??1,'required min="0.000001" step="0.000001"')}<button type="button" class="secondary remove-enquiry-item">Remove unsaved line</button>`;
  row.querySelector('.remove-enquiry-item').onclick=()=>row.remove();$('#crm-enquiry-lines').append(row);await lookup(row.querySelector('.crm-lookup'),'items',line.item_id,line.part_code);
}
function statusForm(record,status){ui.openModal(`Mark enquiry ${status.toLowerCase()}`,`<div class="form-grid"><p class="wide">${esc(record.enquiry_number)}: ${esc(record.status)} → ${esc(status)}</p>${field('Reason','reason','text','','required')}</div>`,form=>saveModal(`/api/crm/enquiries/${record.id}/status`,'PATCH',{status,reason:value(form,'reason')},()=>detail('enquiries',record.id)));}
async function loadPriceLists(){
  try{const result=await ui.api('/api/crm/price-lists');$('#view').innerHTML=`<section class="panel"><header><h2>Price lists</h2>${ui.allowed('items.update')?'<button class="primary" id="new-price-list">New price list</button>':''}</header><p class="muted">Prices and discounts are CRM-owned. Editing a list does not reprice existing quotations.</p>${simpleTable(['Name','Currency','From','To','Discount %','Status',''],result.data.map(l=>[l.name,l.currency,l.effective_from,l.effective_to,l.discount_percent,l.status,{html:`<button class="link price-list-edit" data-id="${l.id}">${ui.allowed('items.update')?'Edit':'View'}</button>`}]))}<button class="secondary" id="price-items-back">Back to items</button></section>`;$('#new-price-list')?.addEventListener('click',()=>priceListForm());$('#price-items-back').onclick=loadCrmItems;$$('.price-list-edit').forEach(b=>b.onclick=async()=>{const list=(await ui.api(`/api/crm/price-lists/${b.dataset.id}`)).data;if(ui.allowed('items.update'))priceListForm(list);else ui.openModal(list.name,simpleTable(['Item','Minimum qty','Unit price','Discount %'],list.entries.map(e=>[e.part_code,e.min_quantity,e.unit_price,e.discount_percent])),null);});}catch(error){ui.toast(error.message,true);}
}
async function priceListForm(list=null){
  ui.openModal(list?'Edit price list':'New price list',`<div class="form-grid">${field('Name','name','text',list?.name,'required')}${field('Currency','currency','text',list?.currency||'INR','required maxlength="3"')}${field('Effective from','effectiveFrom','date',list?.effective_from||new Date().toISOString().slice(0,10),'required')}${field('Effective to','effectiveTo','date',list?.effective_to)}${field('List discount %','discountPercent','number',list?.discount_percent??0,'min="0" max="100" step="0.000001" required')}${select('Status','status',['ACTIVE','INACTIVE','ARCHIVED'].map(s=>[s,s]),list?.status||'ACTIVE')}<div class="wide"><h3>Item price tiers</h3><div id="price-tiers"></div><button id="add-price-tier" type="button" class="secondary">Add price tier</button></div>${field('Reason','reason','text','',''+(list?'required':''))}</div>`,form=>saveModal(`/api/crm/price-lists${list?'/'+list.id:''}`,list?'PATCH':'POST',{name:value(form,'name'),currency:value(form,'currency'),effectiveFrom:value(form,'effectiveFrom'),effectiveTo:value(form,'effectiveTo'),discountPercent:value(form,'discountPercent'),status:value(form,'status'),reason:value(form,'reason'),entries:[...form.querySelectorAll('.crm-price-tier')].map(row=>({id:row.dataset.id||undefined,itemId:row.querySelector('select').value,minQuantity:row.querySelector('[name=minQuantity]').value,unitPrice:row.querySelector('[name=unitPrice]').value,discountPercent:row.querySelector('[name=tierDiscount]').value}))},loadPriceLists));
  for(const entry of list?.entries||[{}])await addPriceTier(entry);$('#add-price-tier').onclick=()=>addPriceTier();
}
async function addPriceTier(entry={}){
  const row=document.createElement('div');row.className='crm-price-tier';if(entry.id)row.dataset.id=entry.id;
  row.innerHTML=`${lookupHtml('Item','tierItem')}${field('Minimum quantity','minQuantity','number',entry.min_quantity??1,'min="0.000001" step="0.000001" required')}${field('Unit price','unitPrice','number',entry.unit_price??0,'min="0" step="0.000001" required')}${field('Tier discount %','tierDiscount','number',entry.discount_percent??0,'min="0" max="100" step="0.000001" required')}<button type="button" class="secondary remove-tier">${entry.id?'Archive tier on save':'Remove unsaved tier'}</button>`;
  row.querySelector('.remove-tier').onclick=()=>row.remove();$('#price-tiers').append(row);await lookup(row.querySelector('.crm-lookup'),'items',entry.item_id,entry.part_code);
}
