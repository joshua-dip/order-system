'use client';

import { usePathname } from 'next/navigation';
import { getPublicSiteUrl, SOLVOOK_BRAND_PAGE_URL } from '@/lib/site-branding';

const Footer = () => {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin/syntax-analyzer') || pathname?.startsWith('/my/vip')) {
    return null;
  }

  const companyName = process.env.NEXT_PUBLIC_FOOTER_COMPANY_NAME ?? '';
  const repName = process.env.NEXT_PUBLIC_FOOTER_REP_NAME ?? '';
  const bizNumber = process.env.NEXT_PUBLIC_FOOTER_BIZ_NUMBER ?? '';
  const address = process.env.NEXT_PUBLIC_FOOTER_ADDRESS ?? '';
  const phone = process.env.NEXT_PUBLIC_FOOTER_PHONE ?? '';
  const hasBusinessInfo = companyName || repName || bizNumber || address || phone;
  const siteUrl = getPublicSiteUrl();

  return (
    <footer className="py-4 mt-auto bg-slate-50 text-slate-600 border-t border-slate-200">
      <div className="container mx-auto px-4">
        <div className="pt-2">
          <div className="text-center text-[11px] text-slate-500 space-y-1.5">
            {hasBusinessInfo ? (
              <>
                {companyName && <div className="font-semibold text-sm mb-2">{companyName}</div>}
                {(repName || bizNumber) && (
                  <div className="flex flex-col md:flex-row md:justify-center md:space-x-4 space-y-1 md:space-y-0">
                    {repName && <span>대표자: {repName}</span>}
                    {repName && bizNumber && <span className="hidden md:inline">|</span>}
                    {bizNumber && <span>사업자등록번호: {bizNumber}</span>}
                  </div>
                )}
                {address && <div><span>주소: {address}</span></div>}
                {phone && <div><span>전화: {phone}</span></div>}
              </>
            ) : null}
            <div className={`${hasBusinessInfo ? 'mt-2 pt-2 border-t border-slate-200' : ''} space-y-1.5`}>
              {siteUrl ? (
                <p>
                  <a
                    href={siteUrl}
                    className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
                  >
                    고미조슈아 홈
                  </a>
                  <span className="text-slate-300 mx-2">·</span>
                  <a
                    href={SOLVOOK_BRAND_PAGE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
                  >
                    쏠북(Solvook) 브랜드
                  </a>
                </p>
              ) : (
                <p>
                  <a
                    href={SOLVOOK_BRAND_PAGE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
                  >
                    쏠북(Solvook) 고미조슈아 브랜드
                  </a>
                </p>
              )}
              <p className="text-slate-400">© {new Date().getFullYear()} Payperic. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
