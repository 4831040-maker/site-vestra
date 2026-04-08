(function () {
    const SUPABASE_URL = 'https://gquytiqzeckptjttpaum.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_UGVcuo8Ds_sZKVXc5k107A_RMeQE4SR';
    const HOME_URL = `${window.location.origin}/`;
    const APP_HOME_URL = `${window.location.origin}/home/`;
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const pageConfig = window.VESTRA_APP_PAGE || {};
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    const TOP_NAV_STORAGE_KEY = 'vestra-top-nav-active';
    const SUBNAV_STORAGE_KEY = 'vestra-subnav-active';

    const state = {
        session: null,
        authUnavailable: false,
        topNavActive: null,
        subnavActive: null
    };

    const navItems = [
        { href: '/batch', label: 'Batch', match: ['/batch'] },
        { href: '/creative', label: 'Creative', match: ['/creative'] },
        { href: '/pricing', label: 'Pricing', match: ['/pricing'] }
    ];

    function normalizePath(pathname) {
        return pathname.replace(/\/+$/, '') || '/';
    }

    function hasAuthParams() {
        return window.location.hash.includes('access_token')
            || window.location.hash.includes('refresh_token')
            || new URLSearchParams(window.location.search).has('code');
    }

    function getUserNoticeKey(user) {
        return user?.id ? `vestra-generations-visited:${user.id}` : null;
    }

    function hasSeenGenerations(user) {
        const key = getUserNoticeKey(user);
        return key ? window.localStorage.getItem(key) === 'true' : false;
    }

    function markGenerationsSeen(user) {
        const key = getUserNoticeKey(user);
        if (!key) return;

        // TODO: Replace this temporary localStorage flag with a persisted user profile field
        // once the backend state for "has seen generations" is available.
        window.localStorage.setItem(key, 'true');
    }

    function redirectHome() {
        window.location.replace(HOME_URL);
    }

    function redirectAppHome() {
        window.location.replace(APP_HOME_URL);
    }

    function isSupabaseUnavailableError(error) {
        const text = [
            error?.message,
            error?.name,
            error?.code,
            error?.status
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        return /failed to fetch|fetch failed|networkerror|load failed|web server is down|cloudflare|error 521|unexpected token </.test(text);
    }

    function getAuthUnavailableMessage() {
        return 'Authentication is temporarily unavailable because the auth service is not responding. Please try again shortly.';
    }

    function updateStatus(message) {
        document.querySelectorAll('[data-status]').forEach((node) => {
            node.textContent = message;
        });
    }

    function setServiceNotice(message) {
        const shell = document.querySelector('[data-app-shell]');
        if (!shell) return;

        let notice = shell.querySelector('[data-service-notice]');
        if (!notice) {
            notice = document.createElement('section');
            notice.className = 'app-service-notice';
            notice.setAttribute('data-service-notice', '');
            shell.insertBefore(notice, shell.firstChild);
        }

        notice.innerHTML = `<strong>Service Notice</strong><p>${message}</p>`;
    }

    function handleAuthUnavailable(error) {
        if (state.authUnavailable) return;

        state.authUnavailable = true;
        const message = getAuthUnavailableMessage();
        console.error('Supabase auth unavailable:', error);
        updateStatus(message);
        setServiceNotice(message);
    }

    function normalizeStoredValue(value) {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function resolveTopNavActive() {
        const pathMatch = navItems.find((item) => item.match.includes(currentPath))?.href || null;
        if (pathMatch) return pathMatch;

        // The default authenticated dashboard should not highlight any top-level item.
        if (pageConfig.routeKey === 'account') return null;

        return normalizeStoredValue(window.sessionStorage.getItem(TOP_NAV_STORAGE_KEY));
    }

    function resolveSubnavActive() {
        if (pageConfig.routeKey !== 'account') return null;

        return normalizeStoredValue(window.sessionStorage.getItem(SUBNAV_STORAGE_KEY)) || 'all-projects';
    }

    function applyTopNavState() {
        document.querySelectorAll('[data-nav-link]').forEach((link) => {
            const target = link.getAttribute('href') || '';
            const isActive = Boolean(state.topNavActive) && target === state.topNavActive;
            link.classList.toggle('is-active', isActive);
            link.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
    }

    function applySubnavState() {
        document.querySelectorAll('[data-subnav-link]').forEach((link) => {
            const key = link.getAttribute('data-subnav-link') || '';
            const isActive = Boolean(state.subnavActive) && key === state.subnavActive;
            link.classList.toggle('is-active', isActive);
            link.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
    }

    function syncNavigationState() {
        state.topNavActive = resolveTopNavActive();
        state.subnavActive = resolveSubnavActive();

        if (state.topNavActive) {
            window.sessionStorage.setItem(TOP_NAV_STORAGE_KEY, state.topNavActive);
        } else {
            window.sessionStorage.removeItem(TOP_NAV_STORAGE_KEY);
        }

        if (state.subnavActive) {
            window.sessionStorage.setItem(SUBNAV_STORAGE_KEY, state.subnavActive);
        } else {
            window.sessionStorage.removeItem(SUBNAV_STORAGE_KEY);
        }

        applyTopNavState();
        applySubnavState();
    }

    function bindNavigationState() {
        document.querySelectorAll('[data-nav-link]').forEach((link) => {
            link.addEventListener('click', () => {
                const href = normalizeStoredValue(link.getAttribute('href'));
                if (!href) return;

                state.topNavActive = href;
                window.sessionStorage.setItem(TOP_NAV_STORAGE_KEY, href);
                applyTopNavState();
            });
        });

        document.querySelectorAll('[data-subnav-link]').forEach((link) => {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                const key = normalizeStoredValue(link.getAttribute('data-subnav-link'));
                if (!key) return;

                state.subnavActive = key;
                window.sessionStorage.setItem(SUBNAV_STORAGE_KEY, key);
                applySubnavState();
            });
        });
    }

    function updateUserChip(session) {
        const email = session?.user?.email || 'Account';
        document.querySelectorAll('[data-user-email]').forEach((node) => {
            node.textContent = email;
            node.title = email;
        });
    }

    function getAccountSummary(session) {
        const user = session?.user || {};
        const metadata = {
            ...(user.app_metadata || {}),
            ...(user.user_metadata || {})
        };

        // TODO: Replace these temporary fallbacks with billing/profile data from the backend.
        const plan = metadata.plan_name || metadata.plan || 'Starter';
        const credits = metadata.credits_left ?? metadata.credits ?? 12;

        return {
            plan,
            credits
        };
    }

    function updateAccountSummary(session) {
        const { plan, credits } = getAccountSummary(session);

        document.querySelectorAll('[data-plan-name]').forEach((node) => {
            node.textContent = plan;
        });

        document.querySelectorAll('[data-credit-count]').forEach((node) => {
            node.textContent = `${credits} credits`;
        });
    }

    function bindSignOut() {
        document.querySelectorAll('[data-sign-out]').forEach((button) => {
            button.addEventListener('click', async () => {
                const statusTarget = document.querySelector('[data-status]');
                if (statusTarget) {
                    statusTarget.textContent = 'Signing out...';
                }

                try {
                    await supabaseClient.auth.signOut();
                    redirectHome();
                } catch (error) {
                    if (isSupabaseUnavailableError(error)) {
                        handleAuthUnavailable(error);
                        return;
                    }

                    console.error('Sign-out failed:', error);
                    updateStatus('Unable to sign out right now. Please try again.');
                }
            });
        });
    }

    function renderLayout() {
        const shell = document.querySelector('[data-app-shell]');
        if (!shell || shell.querySelector('.app-header')) return;

        const headerNav = navItems.map((item) => {
            const matches = item.match.join(',');
            return `<a class="app-nav-link" data-nav-link data-match="${matches}" href="${item.href}">${item.label}</a>`;
        }).join('');

        const contextRowMarkup = pageConfig.routeKey === 'account'
            ? `
            <div class="app-context-row">
                <div class="app-subnav-inner app-context-inner">
                    <div class="projects-range-label app-context-label">Last 30 days</div>
                </div>
            </div>
        `
            : '';

        const headerMarkup = `
            <header class="app-header">
                <div class="app-header-inner">
                    <div style="display:flex;align-items:center;gap:16px;">
                        <a class="app-wordmark" href="/home/">
                            <img src="/assets/images/logo.svg" alt="VESTRA" class="logo">
                        </a>
                        <nav class="app-nav" aria-label="Main navigation">
                            ${headerNav}
                        </nav>
                    </div>

                    <div style="flex:1"></div>

                    <div class="app-header-controls" style="position:relative;">
                        <span class="credits-text" data-credit-count>12 credits</span>

                        <div style="position:relative;">
                            <button class="avatar" id="avatar-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="avatar-menu" aria-label="Open account menu" title="Account">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3" fill="#777"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7" fill="#777"/></svg>
                            </button>
                            <div class="dropdown-menu" id="avatar-menu" role="menu" aria-label="Account menu">
                                <a href="/dashboard/" role="menuitem" tabindex="-1">Dashboard</a>
                                <a href="/account/" role="menuitem" tabindex="-1">Account</a>
                                <a href="/plans/" role="menuitem" tabindex="-1">Billing</a>
                                <a href="/account/" role="menuitem" tabindex="-1">Payment settings</a>
                                <button type="button" role="menuitem" tabindex="-1" class="dropdown-menu-logout" data-sign-out>Logout</button>
                            </div>
                        </div>
                    </div>
                </div>
            </header>
            <div class="app-subnav" aria-label="Secondary navigation">
                <div class="app-subnav-inner">
                    <nav class="app-subnav-nav" aria-label="Project filters">
                        <a class="app-subnav-link" data-subnav-link="all-projects" href="#">All Projects</a>
                        <a class="app-subnav-link" data-subnav-link="active" href="#">Active</a>
                        <a class="app-subnav-link" data-subnav-link="revisions" href="#">Revisions</a>
                        <a class="app-subnav-link" data-subnav-link="archived" href="#">Archived</a>
                    </nav>
                    <div class="app-subnav-controls">
                        <label class="app-subnav-search" aria-label="Search projects">
                            <svg class="app-subnav-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"></circle>
                                <path d="M16 16L21 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
                            </svg>
                            <input class="app-subnav-search-input" type="search" placeholder="Search projects">
                        </label>
                        <button class="app-subnav-primary" type="button">New Project</button>
                    </div>
                </div>
            </div>
            ${contextRowMarkup}
        `;

        shell.insertAdjacentHTML('afterbegin', headerMarkup);
        syncNavigationState();
        bindNavigationState();
    }

    function attachHeaderMenus() {
        const avatarBtn = document.getElementById('avatar-btn');
        const avatarMenu = document.getElementById('avatar-menu');
        const menuItems = avatarMenu
            ? Array.from(avatarMenu.querySelectorAll('[role="menuitem"]'))
            : [];

        function closeAll() {
            if (avatarMenu) avatarMenu.classList.remove('is-open');
            if (avatarBtn) avatarBtn.setAttribute('aria-expanded', 'false');
        }

        function openMenu() {
            if (!avatarMenu || !avatarBtn) return;
            avatarMenu.classList.add('is-open');
            avatarBtn.setAttribute('aria-expanded', 'true');
        }

        function focusMenuItem(index) {
            const target = menuItems[index];
            if (target) target.focus();
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#avatar-btn') && !e.target.closest('#avatar-menu')) {
                closeAll();
            }
        });

        if (avatarBtn && avatarMenu) {
            avatarBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const open = avatarMenu.classList.contains('is-open');
                if (open) {
                    closeAll();
                    return;
                }
                openMenu();
            });

            avatarBtn.addEventListener('keydown', (ev) => {
                if (ev.key === 'ArrowDown') {
                    ev.preventDefault();
                    openMenu();
                    focusMenuItem(0);
                }
            });
        }

        if (avatarMenu) {
            avatarMenu.addEventListener('keydown', (ev) => {
                const currentIndex = menuItems.indexOf(document.activeElement);

                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    closeAll();
                    if (avatarBtn) avatarBtn.focus();
                    return;
                }

                if (ev.key === 'ArrowDown') {
                    ev.preventDefault();
                    focusMenuItem((currentIndex + 1 + menuItems.length) % menuItems.length);
                    return;
                }

                if (ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    focusMenuItem((currentIndex - 1 + menuItems.length) % menuItems.length);
                }
            });
        }

        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && avatarMenu?.classList.contains('is-open')) {
                closeAll();
                if (avatarBtn) avatarBtn.focus();
            }
        });

        // handle sign-out link inside avatar menu
        document.querySelectorAll('[data-sign-out]').forEach(btn => btn.addEventListener('click', async (e) => {
            e.preventDefault();
            closeAll();
            try {
                await supabaseClient.auth.signOut();
                window.location.replace('/');
            } catch (error) {
                if (isSupabaseUnavailableError(error)) {
                    handleAuthUnavailable(error);
                    return;
                }

                console.error('Sign-out failed:', error);
                updateStatus('Unable to sign out right now. Please try again.');
            }
        }));
    }

    function applyPageState(session) {
        state.session = session;
        updateUserChip(session);
        updateAccountSummary(session);

        if (pageConfig.routeKey === 'home') {
            const noticeBlock = document.querySelector('[data-home-notice]');
            if (noticeBlock) {
                noticeBlock.classList.toggle('is-hidden', hasSeenGenerations(session.user));
            }
        }

        if (pageConfig.routeKey === 'generations') {
            markGenerationsSeen(session.user);
        }

        if (typeof pageConfig.onAuthenticated === 'function') {
            pageConfig.onAuthenticated(session, { hasSeenGenerations, markGenerationsSeen, getAccountSummary });
        }
    }

    async function initProtectedPage() {
        renderLayout();
        attachHeaderMenus();
        bindSignOut();

        let data;

        try {
            const result = await supabaseClient.auth.getSession();
            data = result.data;
        } catch (error) {
            if (isSupabaseUnavailableError(error)) {
                handleAuthUnavailable(error);
                return;
            }

            throw error;
        }

        if (data.session) {
            applyPageState(data.session);
            return;
        }

        if (pageConfig.allowAuthParams && hasAuthParams()) {
            const statusTarget = document.querySelector('[data-status]');
            if (statusTarget) {
                statusTarget.textContent = 'Finalizing your sign-in...';
            }
            return;
        }

        redirectHome();
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (state.authUnavailable) return;

        if (session?.user) {
            applyPageState(session);
            return;
        }

        if (event === 'SIGNED_OUT') {
            redirectHome();
            return;
        }

        if (event === 'INITIAL_SESSION' && !session && pageConfig.allowAuthParams && hasAuthParams()) {
            return;
        }
    });

    window.VESTRA_APP = {
        redirectHome,
        redirectAppHome,
        supabaseClient
    };

    initProtectedPage();
})();
