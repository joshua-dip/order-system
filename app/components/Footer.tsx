'use client';

const Footer = () => {
  return (
    <footer className="py-4 mt-auto" style={{ backgroundColor: '#F5C6CB', color: '#333' }}>
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
          {/* 회사 정보 */}
          <div className="flex items-center">
            <h3 className="text-lg font-bold">고미조슈아</h3>
          </div>

          {/* 문의 정보 */}
          <div className="flex flex-col md:flex-row items-center space-y-3 md:space-y-0 md:space-x-4">
            <a 
              href="https://open.kakao.com/o/sHuV7wSh"
              target="_blank"
              rel="noopener noreferrer"
                  className="inline-flex items-center space-x-2 px-3 py-2 rounded text-sm font-medium hover:opacity-90 transition-all border-2"
                  style={{ backgroundColor: '#13294B', color: 'white', borderColor: '#13294B' }}
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
              >
                <path 
                  d="M12 3C6.48 3 2 6.58 2 11c0 2.4 1.17 4.55 3 6.06V21l3.94-2.06c.97.27 2 .42 3.06.42 5.52 0 10-3.58 10-8s-4.48-8-10-8z" 
                  fill="currentColor"
                />
              </svg>
              <span>카톡 문의</span>
            </a>
            <a 
              href="tel:01079270806"
              className="text-blue-600 font-medium hover:text-blue-700 transition-colors"
            >
              📞 010-7927-0806
            </a>
          </div>
        </div>

        {/* 저작권 */}
        <div className="border-t border-gray-400 mt-4 pt-4">
          <div className="text-center text-xs text-gray-600">
            <p>© 2025 (주)DipThink. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
