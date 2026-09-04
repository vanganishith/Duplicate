import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import OfficerLoginPage from '../pages/OfficerLoginPage';
import { LanguageProvider } from '../context/LanguageContext';

const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

describe('Phase: Officer Login & Auth Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedNavigate.mockReset();
  });

  const renderComponent = () =>
    render(
      <BrowserRouter>
        <LanguageProvider>
          <OfficerLoginPage />
        </LanguageProvider>
      </BrowserRouter>
    );

  // 1. Valid AEO001 / 123456 succeeds
  it('succeeds with valid demo credentials AEO001 / 123456 and navigates to /aeo', () => {
    renderComponent();

    const idInput = screen.getByTestId('officer-id-input');
    const passInput = screen.getByTestId('officer-password-input');
    const submitBtn = screen.getByTestId('officer-login-submit-btn');

    fireEvent.change(idInput, { target: { value: 'AEO001' } });
    fireEvent.change(passInput, { target: { value: '123456' } });
    fireEvent.click(submitBtn);

    expect(mockedNavigate).toHaveBeenCalledWith('/aeo');
    const sessionStr = localStorage.getItem('aeo_officer_session');
    expect(sessionStr).toBeDefined();
    const session = JSON.parse(sessionStr);
    expect(session.officer_id).toBe('AEO001');
  });

  // 2. Invalid Officer ID fails
  it('fails with invalid officer ID and displays error message', () => {
    renderComponent();

    const idInput = screen.getByTestId('officer-id-input');
    const passInput = screen.getByTestId('officer-password-input');
    const submitBtn = screen.getByTestId('officer-login-submit-btn');

    fireEvent.change(idInput, { target: { value: 'WRONG_ID' } });
    fireEvent.change(passInput, { target: { value: '123456' } });
    fireEvent.click(submitBtn);

    expect(mockedNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('login-error-message')).toBeDefined();
    expect(screen.getByText(/Invalid Officer ID or password/i)).toBeDefined();
  });

  // 3. Invalid Password fails
  it('fails with invalid password and displays error message', () => {
    renderComponent();

    const idInput = screen.getByTestId('officer-id-input');
    const passInput = screen.getByTestId('officer-password-input');
    const submitBtn = screen.getByTestId('officer-login-submit-btn');

    fireEvent.change(idInput, { target: { value: 'AEO001' } });
    fireEvent.change(passInput, { target: { value: 'wrong_password' } });
    fireEvent.click(submitBtn);

    expect(mockedNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('login-error-message')).toBeDefined();
    expect(screen.getByText(/Invalid Officer ID or password/i)).toBeDefined();
  });
});
