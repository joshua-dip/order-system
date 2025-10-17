'use client';

const Footer = () => {
  return (
    <footer className="py-4 mt-auto" style={{ backgroundColor: '#F5C6CB', color: '#333' }}>
      <div className="container mx-auto px-4">
        {/* 사업자 정보 */}
        <div className="border-t border-gray-400 mt-4 pt-4">
          <div className="text-center text-xs text-gray-600 space-y-2">
            <div className="font-semibold text-sm mb-2">페이퍼릭 (Payperic)</div>
            <div className="flex flex-col md:flex-row md:justify-center md:space-x-4 space-y-1 md:space-y-0">
              <span>대표자: 박준규</span>
              <span className="hidden md:inline">|</span>
              <span>사업자등록번호: 246-47-01070</span>
            </div>
            <div>
              <span>주소: 부산광역시 해운대구 센텀중앙로 48, 1304호(우동, 에이스하이테크21)</span>
            </div>
            <div>
              <span>전화: 010-7927-0806</span>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-300">
              <p>© 2025 Payperic. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
