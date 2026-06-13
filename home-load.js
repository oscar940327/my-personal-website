const title = document.querySelector('.hero-title');

if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

window.scrollTo(0, 0);

if (title) {
    const text = title.textContent.trim().replace(/\s+/g, ' ');
    const words = text.split(' ');
    title.textContent = '';
    title.setAttribute('aria-label', text);
    title.classList.add('is-split');

    let letterIndex = 0;

    words.forEach(word => {
        const line = document.createElement('span');
        line.className = 'hero-title-line';

        Array.from(word).forEach(character => {
            const letter = document.createElement('span');
            letter.className = 'hero-title-letter';
            letter.setAttribute('aria-hidden', 'true');
            letter.style.setProperty('--letter-delay', `${0.80 + letterIndex * 0.06}s`);
            letter.textContent = character;
            line.appendChild(letter);
            letterIndex += 1;
        });

        title.appendChild(line);
    });
}

const scrollRevealItems = document.querySelectorAll('.scroll-reveal');

if (scrollRevealItems.length > 0) {
    const revealOnScroll = () => {
        if (window.scrollY < 80) {
            scrollRevealItems.forEach(item => {
                item.classList.remove('is-visible');
            });
            return;
        }

        scrollRevealItems.forEach(item => {
            const rect = item.getBoundingClientRect();
            const isNearViewport = rect.top < window.innerHeight * 0.86 && rect.bottom > 0;

            if (isNearViewport) {
                item.classList.add('is-visible');
            }
        });
    };

    window.addEventListener('scroll', revealOnScroll, { passive: true });
    window.addEventListener('resize', revealOnScroll);
}
