import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppContainer } from '@lark-apaas/client-toolkit';

import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import ProjectListPage from './pages/ProjectList/ProjectListPage';
import ProjectWorkbenchPage from './pages/ProjectWorkbench/ProjectWorkbenchPage';
import SettingsPage from './pages/Settings/SettingsPage';
import ComposeEmailPage from './pages/ComposeEmail/ComposeEmailPage';
import LoginPage from './pages/Login/LoginPage';
import RegisterPage from './pages/Register/RegisterPage';
import UserManagementPage from './pages/UserManagement/UserManagementPage';
import ProtectedRoute from './components/ProtectedRoute';

const RoutesComponent = () => {
  return (
    <AppContainer>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<ProjectListPage />} />
            <Route path="projects" element={<ProjectListPage />} />
            <Route path="projects/:id" element={<ProjectWorkbenchPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="compose/:companyId" element={<ComposeEmailPage />} />
            <Route path="admin/users" element={<UserManagementPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </AppContainer>
  );
};

export default RoutesComponent;
