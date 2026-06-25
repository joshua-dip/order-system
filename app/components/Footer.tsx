'use client';

import { usePathname } from 'next/navigation';
import { getPublicSiteUrl, SOLVOOK_BRAND_PAGE_URL } from '@/lib/site-branding';

const Footer = () => {
  const pathname = usePathname();
  // 메인 페이지(`/`) 에서만 푸터를 노출한다. 다른 경로(주문 흐름·관리자·내 정보 등)
  // 에서는 푸터를 띄우지 않는다.
  if (pathname !== '/') {
    return null;
  }

  const companyName = process.env.NEXT_PUBLIC_FOOTER_COMPANY_NAME ?? '';
  const repName = process.env.NEXT_PUBLIC_FOOTER_REP_NAME ?? '';
  const bizNumber = process.env.NEXT_PUBLIC_FOOTER_BIZ_NUMBER ?? '';
  const mailOrderRegNumber = process.env.NEXT_PUBLIC_FOOTER_MAIL_ORDER_REG_NUMBER ?? '';
  const address = process.env.NEXT_PUBLIC_FOOTER_ADDRESS ?? '';
  const phone = process.env.NEXT_PUBLIC_FOOTER_PHONE ?? '';
  const hasBusinessInfo = companyName || repName || bizNumber || mailOrderRegNumber || address || phone;
  const siteUrl = getPublicSiteUrl();
  // © 줄 표시명. companyName 미설정 시 'Payperic' 폴백.
  const copyrightHolder = companyName || 'Payperic';

  return (
    <footer className="py-4 mt-auto bg-slate-50 text-slate-600 border-t border-slate-200">
      <div className="container mx-auto px-4">
        <div className="pt-2">
          <div className="text-center text-[11px] text-slate-500 space-y-1.5">
            {hasBusinessInfo ? (
              <>
                {companyName && <div className="font-semibold text-sm mb-2">{companyName}</div>}
                {(repName || bizNumber || mailOrderRegNumber) && (
                  <div className="flex flex-col md:flex-row md:justify-center md:flex-wrap md:gap-x-4 md:gap-y-1 space-y-1 md:space-y-0">
                    {repName && <span>대표자: {repName}</span>}
                    {repName && bizNumber && <span className="hidden md:inline">·</span>}
                    {bizNumber && <span>사업자등록번호: {bizNumber}</span>}
                    {(repName || bizNumber) && mailOrderRegNumber && (
                      <span className="hidden md:inline">·</span>
                    )}
                    {mailOrderRegNumber && <span>통신판매업신고: {mailOrderRegNumber}</span>}
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
              <p className="text-slate-400"><span suppressHydrationWarning>© {new Date().getFullYear()}</span> {copyrightHolder}. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
