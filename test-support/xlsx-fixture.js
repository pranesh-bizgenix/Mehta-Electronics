import {deflateRawSync} from 'node:zlib';
export function fixtureZip(contents){
 const local=[],central=[];let offset=0;
 for(const [name,text]of Object.entries(contents)){
  const raw=Buffer.from(text),packed=deflateRawSync(raw),filename=Buffer.from(name);let crc=0xffffffff;
  for(const b of raw){crc^=b;for(let k=0;k<8;k++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}crc=(crc^0xffffffff)>>>0;
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(filename.length,26);local.push(h,filename,packed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);central.push(c,filename);offset+=30+filename.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(contents).length,8);end.writeUInt16LE(Object.keys(contents).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function priceWorkbookFixture(rows,extra={}){
 const column=index=>String.fromCharCode(65+index);
 const sheet='<worksheet><sheetData>'+rows.map((values,i)=>`<row r="${i+1}">${values.map((cell,c)=>cell===null?'':`<c r="${column(c)}${i+1}"${typeof cell==='object'?'':' t="inlineStr"'}>${typeof cell==='object'?`${cell.formula?'<f>'+escape(cell.formula)+'</f>':''}<v>${escape(cell.value)}</v>`:'<is><t>'+escape(cell)+'</t></is>'}</c>`).join('')}</row>`).join('')+'</sheetData></worksheet>';
 return fixtureZip({'xl/workbook.xml':'<workbook><sheets><sheet name="ZZTEST Prices" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':sheet,...extra});
}
