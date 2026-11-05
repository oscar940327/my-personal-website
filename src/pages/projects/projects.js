const showcase = document.querySelector('.works-showcase');
const visualTrack = document.querySelector('.project-visual-track');
const copies = Array.from(document.querySelectorAll('.project-copy'));
const indexLabel = document.querySelector('.project-index');
const digitWindow = document.querySelector('.digit-window');

if (showcase && visualTrack && copies.length > 0) {
    let activeProject = 0;
    let textRevealTimer = null;
    let ticking = false;
    const projectCount = copies.length;
    const maxProject = projectCount - 1;
    const textRevealDelay = 400;
    const visuals = Array.from(visualTrack.querySelectorAll('.project-visual'));

    const mobileList = document.createElement('section');
    mobileList.className = 'project-mobile-list';
    mobileList.setAttribute('aria-label', 'Projects');

    copies.forEach((copy, index) => {
        const panel = document.createElement('article');
        const image = visuals[index]?.querySelector('img')?.cloneNode(true);
        const mobileCopy = copy.cloneNode(true);
        const projectTitle = copy.querySelector('h2')?.textContent.trim() || `Project ${index + 1}`;

        panel.className = 'mobile-project';
        if (image) {
            image.alt = `${projectTitle} project preview`;
            const figure = document.createElement('figure');
            figure.className = 'mobile-project-visual';
            figure.append(image);
            panel.append(figure);
        }

        mobileCopy.classList.remove('is-active');
        mobileCopy.classList.add('mobile-project-copy');
        const projectNumber = document.createElement('p');
        projectNumber.className = 'mobile-project-index';
        projectNumber.textContent = `[ ${String(index + 1).padStart(2, '0')} / ${String(copies.length).padStart(2, '0')} ]`;
        mobileCopy.prepend(projectNumber);
        panel.append(mobileCopy);
        mobileList.append(panel);
    });

    showcase.append(mobileList);

    if ('IntersectionObserver' in window) {
        const mobileObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    mobileObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12 });

        mobileList.querySelectorAll('.mobile-project').forEach(panel => mobileObserver.observe(panel));
    } else {
        mobileList.querySelectorAll('.mobile-project').forEach(panel => panel.classList.add('is-visible'));
    }

    showcase.style.setProperty('--project-count', projectCount);
    document.documentElement.style.setProperty('--project-count', projectCount);
    document.body.style.setProperty('--project-count', projectCount);

    const syncScrollAxis = () => {
        document.body.dataset.scrollAxis = 'y';
    };

    const syncImageStartPosition = () => {
        if (!indexLabel || window.matchMedia('(max-width: 900px)').matches) {
            return;
        }

        const indexTop = indexLabel.getBoundingClientRect().top;
        const digitHeight = digitWindow?.getBoundingClientRect().height
            || parseFloat(window.getComputedStyle(indexLabel).fontSize)
            || 0;

        showcase.style.setProperty('--project-image-top', `${Math.max(0, indexTop - digitHeight)}px`);
    };

    const setProject = nextProject => {
        if (nextProject === activeProject || nextProject < 0 || nextProject >= projectCount) {
            return;
        }

        window.clearTimeout(textRevealTimer);
        activeProject = nextProject;
        showcase.style.setProperty('--active-project', activeProject);
        visualTrack.style.setProperty('--active-project', activeProject);
        indexLabel?.style.setProperty('--active-project', activeProject);
        indexLabel?.setAttribute('aria-label', `Project ${activeProject + 1} of ${projectCount}`);

        copies.forEach(copy => {
            copy.classList.remove('is-active');
        });

        textRevealTimer = window.setTimeout(() => {
            copies.forEach((copy, index) => {
                copy.classList.toggle('is-active', index === activeProject);
            });
        }, textRevealDelay);
    };

    const syncWithScroll = () => {
        if (window.matchMedia('(max-width: 900px)').matches) {
            return;
        }

        const stageSize = window.innerHeight;
        const scrollPosition = window.scrollY;
        const showcaseStart = showcase.offsetTop;
        const rawProgress = (scrollPosition - showcaseStart) / stageSize;
        const progress = Math.max(0, Math.min(rawProgress, maxProject));
        const nextProject = Math.max(0, Math.min(Math.round(progress), maxProject));

        setProject(nextProject);
    };

    const requestSync = () => {
        if (ticking) {
            return;
        }

        ticking = true;
        window.requestAnimationFrame(() => {
            syncWithScroll();
            ticking = false;
        });
    };

    syncScrollAxis();
    syncWithScroll();
    syncImageStartPosition();
    window.addEventListener('scroll', requestSync, { passive: true });
    window.addEventListener('resize', () => {
        syncScrollAxis();
        syncImageStartPosition();
        requestSync();
    });
    window.addEventListener('load', syncImageStartPosition);
    document.fonts?.ready.then(syncImageStartPosition);
}
