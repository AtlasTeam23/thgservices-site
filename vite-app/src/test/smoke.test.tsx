import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('test setup', () => {
  it('renders React in jsdom with jest-dom matchers', () => {
    render(<p>hello</p>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
