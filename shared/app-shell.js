(function () {
    const SUPABASE_URL = 'https://gquytiqzeckptjttpaum.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_UGVcuo8Ds_sZKVXc5k107A_RMeQE4SR';
    const HOME_URL = `${window.location.origin}/`;
    const APP_HOME_URL = `${window.location.origin}/home/`;
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const pageConfig = window.VESTRA_APP_PAGE || {};
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';

    const state = {
        session: null
    };

    const navItems = [
        { href: '/home/', label: 'Home', match: ['/home'] },
        { href: '/dashboard/', label: 'Studio', match: ['/dashboard', '/dashboard/generations'] },
        { href: '/plans/', label: 'Plans', match: ['/plans'] }
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

    function setActiveNav() {
        document.querySelectorAll('[data-nav-link]').forEach((link) => {
            const matchPaths = (link.getAttribute('data-match') || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            const isActive = matchPaths.includes(currentPath);
            link.classList.toggle('is-active', isActive);
            link.setAttribute('aria-current', isActive ? 'page' : 'false');
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

                await supabaseClient.auth.signOut();
                redirectHome();
            });
        });
    }

    function renderLayout() {
        const shell = document.querySelector('[data-app-shell]');
        if (!shell) return;

        const headerNav = navItems.map((item) => {
            const matches = item.match.join(',');
            return `<a class="app-nav-link" data-nav-link data-match="${matches}" href="${item.href}">${item.label}</a>`;
        }).join('');

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
        `;

        shell.insertAdjacentHTML('afterbegin', headerMarkup);
        setActiveNav();
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
            await supabaseClient.auth.signOut();
            window.location.replace('/');
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

        const { data } = await supabaseClient.auth.getSession();

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
