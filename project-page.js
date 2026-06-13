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

    showcase.style.setProperty('--project-count', projectCount);

    const syncImageStartPosition = () => {
        if (!indexLabel) {
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
        const stageHeight = window.innerHeight;
        const showcaseTop = showcase.offsetTop;
        const rawProgress = (window.scrollY - showcaseTop) / stageHeight;
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

    syncWithScroll();
    syncImageStartPosition();
    window.addEventListener('scroll', requestSync, { passive: true });
    window.addEventListener('resize', () => {
        syncImageStartPosition();
        requestSync();
    });
    window.addEventListener('load', syncImageStartPosition);
    document.fonts?.ready.then(syncImageStartPosition);
}
