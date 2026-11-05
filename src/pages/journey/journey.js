const timeline = document.querySelector('.timeline');

if (timeline) {
    const children = Array.from(timeline.children);
    const pairs = [];
    const readyPairs = new Set();
    let nextPairIndex = 0;
    let isRevealing = false;
    const contentDelay = 130;
    const nextPairDelay = 680;

    for (let index = 0; index < children.length; index += 1) {
        const dot = children[index];
        const item = children[index + 1];

        if (!dot?.classList.contains('timeline-dot') || !item?.classList.contains('timeline-item')) {
            continue;
        }

        const text = item.querySelector('.timeline-content div');
        const pairIndex = pairs.length;
        dot.style.setProperty('--timeline-order', pairIndex);
        item.style.setProperty('--timeline-order', pairIndex);

        if (text) {
            const characterCount = text.textContent.trim().length;
            text.style.setProperty('--type-steps', Math.max(characterCount, 1));
        }

        pairs.push({ dot, item });
    }

    const revealPair = ({ dot, item }) => {
        isRevealing = true;
        dot.classList.add('is-visible');
        window.setTimeout(() => {
            item.classList.add('is-visible');
        }, contentDelay);

        window.setTimeout(() => {
            nextPairIndex += 1;
            isRevealing = false;
            revealReadyPairs();
        }, nextPairDelay);
    };

    const revealReadyPairs = () => {
        if (isRevealing || nextPairIndex >= pairs.length || !readyPairs.has(nextPairIndex)) {
            return;
        }

        revealPair(pairs[nextPairIndex]);
    };

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) {
                    return;
                }

                const pair = pairs.find(candidate => candidate.dot === entry.target);
                if (pair) {
                    readyPairs.add(pairs.indexOf(pair));
                    observer.unobserve(pair.dot);
                    revealReadyPairs();
                }
            });
        }, {
            threshold: 0.35,
            rootMargin: '0px 0px -12% 0px',
        });

        pairs.forEach(pair => observer.observe(pair.dot));
    } else {
        pairs.forEach((pair, index) => {
            window.setTimeout(() => {
                readyPairs.add(index);
                revealReadyPairs();
            }, index * 200);
        });
    }
}
