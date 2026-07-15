document.querySelectorAll('.theme-toggle').forEach(themeToggle => {
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });
});

const headerHTML = `
<header class="site-sidebar" aria-label="Primary navigation">
    <a class="brand-mark" href="index.html" aria-label="Oscar Cheng home">OSCAR</a>

    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-menu" aria-label="Open navigation menu">
        <span></span>
        <span></span>
    </button>

    <nav class="sidebar-menu" id="primary-menu">
        <a href="index.html">HOME</a>
        <a href="project_page.html">PROJECT</a>
        <a href="timeline_page.html">JOURNEY</a>
        <a href="mkt_agent.html">MktAgent</a>
        <a href="video_note.html">VideoNote</a>
        <span class="nav-indicator" aria-hidden="true"></span>
    </nav>

    <div class="sidebar-social" aria-label="Social links">
        <a href="https://github.com/oscar940327" target="_blank" aria-label="GitHub">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2.6c-5.4 0-9.7 4.4-9.7 9.7 0 4.3 2.8 8 6.7 9.2.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.2-3.3-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.8.8.1-.6.3-1.1.6-1.3-2.2-.2-4.5-1.1-4.5-4.8 0-1.1.4-1.9 1-2.6-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1 .8-.2 1.6-.3 2.4-.3s1.7.1 2.4.3c1.8-1.2 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.5 1 2.6 0 3.7-2.3 4.5-4.5 4.8.4.3.7.9.7 1.8V21c0 .3.2.6.7.5 3.9-1.3 6.7-4.9 6.7-9.2 0-5.3-4.3-9.7-9.7-9.7Z" />
            </svg>
        </a>
        <a href="https://mail.google.com/mail/?view=cm&to=oscar940327@gmail.com" target="_blank" aria-label="Email">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 6.2h15c.8 0 1.5.7 1.5 1.5v8.6c0 .8-.7 1.5-1.5 1.5h-15c-.8 0-1.5-.7-1.5-1.5V7.7c0-.8.7-1.5 1.5-1.5Zm.7 2.2 6.8 4.5 6.8-4.5H5.2Zm13.7 7.2v-5l-6.4 4.2c-.3.2-.7.2-1 0l-6.4-4.2v5h13.8Z" />
            </svg>
        </a>
    </div>
</header>

<footer class="site-credit">© Oscar Cheng</footer>
`;

{
    const headerPlaceholder = document.getElementById('header-placeholder');
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    const loadHeaderHTML = async () => {
        try {
            const response = await fetch('header.html', { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`Unable to load header.html: ${response.status}`);
            }
            return await response.text();
        } catch {
            return headerHTML;
        }
    };

    const initHeader = async () => {
        if (!headerPlaceholder) {
            return;
        }

        {
            const template = document.createElement('template');
            template.innerHTML = await loadHeaderHTML();
            headerPlaceholder.replaceChildren(template.content);
        }
        headerPlaceholder.classList.add('header-ready');

        sessionStorage.removeItem('internalPageNavigation');

        const navToggle = document.querySelector('.nav-toggle');
        const sidebarMenu = document.querySelector('.sidebar-menu');
        const sidebarLinks = sidebarMenu ? Array.from(sidebarMenu.querySelectorAll('a')) : [];
        let activeSidebarLink = null;

        sidebarLinks.forEach(link => {
            const linkPage = link.getAttribute('href');
            link.classList.toggle('active', linkPage === currentPage);
            if (linkPage === currentPage) {
                activeSidebarLink = link;
            }
        });

        if (!activeSidebarLink && sidebarLinks.length > 0) {
            activeSidebarLink = sidebarLinks[0];
            activeSidebarLink.classList.add('active');
        }

        const moveSidebarIndicator = link => {
            if (!sidebarMenu || !link) {
                return;
            }

            const isHorizontal = getComputedStyle(sidebarMenu).flexDirection === 'row';
            const menuStyle = getComputedStyle(sidebarMenu);
            const lineGap = parseFloat(menuStyle.getPropertyValue('--line-gap')) || (isHorizontal ? 5 : 7);
            const x = isHorizontal ? link.offsetLeft : 0;
            const y = link.offsetTop + link.offsetHeight + lineGap;

            sidebarMenu.style.setProperty('--indicator-x', `${x}px`);
            sidebarMenu.style.setProperty('--indicator-y', `${y}px`);
            if (isHorizontal) {
                sidebarMenu.style.setProperty('--indicator-width', `${link.offsetWidth}px`);
            }
            sidebarMenu.style.setProperty('--indicator-opacity', '1');
            sidebarMenu.style.setProperty('--indicator-scale', '1');
        };

        if (activeSidebarLink) {
            requestAnimationFrame(() => {
                moveSidebarIndicator(activeSidebarLink);
                requestAnimationFrame(() => {
                    sidebarMenu.classList.add('is-ready');
                });
            });

            sidebarLinks.forEach(link => {
                link.addEventListener('click', event => {
                    const targetPage = link.getAttribute('href');

                    if (!targetPage || targetPage === currentPage || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                        return;
                    }

                    event.preventDefault();
                    sessionStorage.setItem('internalPageNavigation', 'true');
                    activeSidebarLink.classList.add('is-exiting');
                    link.classList.add('is-pending');
                    sidebarMenu.classList.add('is-leaving');

                    window.setTimeout(() => {
                        window.location.href = targetPage;
                    }, 720);
                });
            });

            window.addEventListener('resize', () => {
                moveSidebarIndicator(activeSidebarLink);
            });
        }

        if (navToggle && sidebarMenu) {
            const setMenuOpen = isOpen => {
                navToggle.classList.toggle('is-open', isOpen);
                sidebarMenu.classList.toggle('is-open', isOpen);
                navToggle.setAttribute('aria-expanded', String(isOpen));
                navToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
                document.body.classList.toggle('nav-open', isOpen);
            };

            navToggle.addEventListener('click', () => {
                setMenuOpen(navToggle.getAttribute('aria-expanded') !== 'true');
            });

            sidebarLinks.forEach(link => {
                link.addEventListener('click', () => setMenuOpen(false));
            });

            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    setMenuOpen(false);
                    navToggle.focus();
                }
            });

            window.addEventListener('resize', () => {
                if (window.innerWidth > 767) {
                    setMenuOpen(false);
                }
            });
        }

    };

    initHeader();
}
