import Image from 'next/image';

/** Shared Mehta identity for the sign-in screen and workspace navigation. */
export function BrandLogo({compact=false}:{compact?:boolean}){
  return <span className={`ds-brand-mark ds-brand-logo${compact?' ds-brand-logo--compact':''}`}>
    <Image src="/brand/mehta-logo.png" alt="Mehta Electric Corporation logo" width={48} height={48} priority />
  </span>;
}
