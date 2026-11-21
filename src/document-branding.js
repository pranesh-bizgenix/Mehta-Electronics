import {fileURLToPath} from 'node:url';

// PNG prepared from the logo supplied for Mehta's customer documents.
export const companyLogoPath=fileURLToPath(new URL('./assets/mehta-logo.png',import.meta.url));

export function drawCompanyLogo(doc,x,y,size=52){
  doc.image(companyLogoPath,x,y,{fit:[size,size],align:'center',valign:'center'});
}
