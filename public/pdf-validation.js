// Admission check before a response becomes a document URL. Original-file
// integrity and document permissions remain enforced by the existing backend.
/** @param {Blob} blob @returns {Promise<Blob>} */
export async function validatedPdfBlob(blob){
 if(!(blob instanceof Blob)||blob.size<8||blob.type.split(';')[0].trim().toLowerCase()!=='application/pdf'||await blob.slice(0,5).text()!=='%PDF-'){
  throw new Error('The server did not return a valid PDF. Please try again.');
 }
 return new Blob([blob],{type:'application/pdf'});
}
