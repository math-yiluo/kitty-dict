/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        bg: {
          // Soft yellow background — slightly cream so dark text remains comfortable
          DEFAULT: '#FFF8D6',
          deep: '#FCEEA8',
          card: '#FFFCEB'
        },
        ink: {
          DEFAULT: '#1f1f1f',
          soft: '#3a3a3a',
          muted: '#6b6b6b'
        },
        accent: {
          // Green: primary accent for badges, highlights, the speed pill, etc.
          DEFAULT: '#3FA66B',
          soft: '#7CC79B',
          deep: '#247E4D',
          // a paler tint used for backgrounds of selected chips / pills
          tint: '#C9ECD7'
        }
      },
      borderRadius: {
        card: '20px',
        pill: '999px'
      },
      fontFamily: {
        han: [
          // Plangothic P2 covers Unicode Plane 2-3 (CJK Ext B–G). Via
          // unicode-range in app.css it only kicks in for those rare chars
          // (𪜶 etc.); BMP / Ext A still falls through to Noto / PingFang.
          'Plangothic',
          'Noto Sans TC',
          'Noto Sans CJK TC',
          'PingFang TC',
          '"Microsoft JhengHei"',
          'sans-serif'
        ],
        loma: ['"Charis SIL"', '"Doulos SIL"', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
};
