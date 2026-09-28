import { NavLink, Outlet } from 'react-router-dom';
import { FolderKanban, Settings, Languages } from 'lucide-react';
import { useI18n } from '@client/src/i18n';

const Layout = () => {
  const { lang, toggle, t } = useI18n();
  const navItems = [
    { to: '/', label: t('项目列表'), icon: FolderKanban },
    { to: '/settings', label: t('设置'), icon: Settings },
  ];

  return (
    <div className="flex h-screen w-screen bg-slate-50">
      <aside className="w-60 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <h1 className="text-lg font-bold text-slate-800">{t('BD 邮件助手')}</h1>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={toggle}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Languages size={18} />
            <span>{lang === 'en' ? '中文 / English' : t('English')}</span>
            <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {lang === 'en' ? 'EN' : '中'}
            </span>
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="min-h-full p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
