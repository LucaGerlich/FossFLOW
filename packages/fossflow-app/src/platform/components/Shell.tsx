import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { isAdmin, roleLabelKey, type SessionUser, signOut } from '../session';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-item nav-item--active' : 'nav-item';

/** n8n-style frame: sidebar with Overview and Settings, page content beside it. */
export function Shell({ user }: { user: SessionUser }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onSignOut = async () => {
    await signOut();
    queryClient.clear();
    navigate('/signin', { replace: true });
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">FossFLOW</div>
        <nav className="sidebar__nav" aria-label={t('platform.nav.label')}>
          <NavLink to="/" end className={navClass}>
            {t('platform.nav.overview')}
          </NavLink>
        </nav>
        <div className="sidebar__bottom">
          {isAdmin(user) && (
            <nav className="sidebar__nav" aria-label={t('platform.nav.settings')}>
              <span className="sidebar__heading">{t('platform.nav.settings')}</span>
              <NavLink to="/settings/users" className={navClass}>
                {t('platform.nav.users')}
              </NavLink>
            </nav>
          )}
          <div className="user-chip">
            <div className="user-chip__text">
              <span className="user-chip__name">{user.name}</span>
              <span className="user-chip__role">{t(roleLabelKey(user.instanceRole))}</span>
            </div>
            <button className="btn btn--sm" type="button" onClick={onSignOut}>
              {t('platform.nav.signOut')}
            </button>
          </div>
        </div>
      </aside>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
