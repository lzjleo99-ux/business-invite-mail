import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import ProjectListPage from './pages/ProjectList/ProjectListPage';
import ProjectWorkbenchPage from './pages/ProjectWorkbench/ProjectWorkbenchPage';
import SettingsPage from './pages/Settings/SettingsPage';
import ComposeEmailPage from './pages/ComposeEmail/ComposeEmailPage';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProjectListPage />} />
        <Route path="projects" element={<ProjectListPage />} />
        <Route path="projects/:id" element={<ProjectWorkbenchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="compose/:companyId" element={<ComposeEmailPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
