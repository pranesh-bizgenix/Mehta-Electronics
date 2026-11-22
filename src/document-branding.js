import {fileURLToPath} from 'node:url';

// Existing optimised Mehta logo, large enough for the 52-point letterhead mark.
// Keeps document downloads small without embedding the 1 MB source artwork.
export const companyLogoPath=fileURLToPath(new URL('./assets/mehta-logo-document.png',import.meta.url));

export function drawCompanyLogo(doc,x,y,size=52){
  doc.image(companyLogoPath,x,y,{fit:[size,size],align:'center',valign:'center'});
}
