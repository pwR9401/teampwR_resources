if (!document.getElementById('barrel-roll-styles')) {
  const style = document.createElement('style');
  style.id = 'barrel-roll-styles';
  style.innerHTML = `
    @keyframes barrelRoll {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .spin-me {
      animation: barrelRoll 1s ease-in-out;
    }
    /* Hide scrollbars globally during the spin */
    .no-scroll {
      overflow: hidden !important;
    }
  `;
  document.head.appendChild(style);
}

const target = document.body;
const htmlElement = document.documentElement;

if (!target.classList.contains('spin-me')) {
  target.classList.add('spin-me');
  htmlElement.classList.add('no-scroll');

  setTimeout(() => {
    target.classList.remove('spin-me');
    htmlElement.classList.remove('no-scroll');
  }, 1000);
}