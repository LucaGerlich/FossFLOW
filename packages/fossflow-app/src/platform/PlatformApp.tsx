import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { routerBasename } from '../basePath';
import '../App.css';
import { Shell } from './components/Shell';
import type { PlatformStatus } from './detect';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SetupPage } from './pages/SetupPage';
import { SignInPage } from './pages/SignInPage';
import { UsersPage } from './pages/UsersPage';
import './platform.css';
import { isAdmin, useSession } from './session';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } }
});

/** The platform: sign-in, the app shell, and settings. */
export function PlatformApp({ status }: { status: PlatformStatus }) {
  const [setupRequired, setSetupRequired] = useState(status.setupRequired);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={routerBasename()}>
        {setupRequired ? (
          <Routes>
            <Route path="*" element={<SetupPage onDone={() => setSetupRequired(false)} />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/signin" element={<SignInPage mailEnabled={status.mailEnabled} />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/*" element={<SignedIn />} />
          </Routes>
        )}
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/** Everything behind sign-in; unknown paths fall back to the overview. */
function SignedIn() {
  const { t } = useTranslation('app');
  const location = useLocation();
  const session = useSession();

  if (session.isPending) return <p className="page-loading">{t('platform.loading')}</p>;
  const user = session.data;
  if (!user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  return (
    <Routes>
      <Route element={<Shell user={user} />}>
        <Route index element={<HomePage />} />
        <Route
          path="settings/users"
          element={<AdminOnly allowed={isAdmin(user)}><UsersPage me={user} /></AdminOnly>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AdminOnly({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return allowed ? <>{children}</> : <Navigate to="/" replace />;
}
