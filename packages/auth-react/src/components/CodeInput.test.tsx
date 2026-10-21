// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeInput } from './CodeInput';

afterEach(cleanup);

function Entry({ onComplete = vi.fn(), ...props }: Partial<React.ComponentProps<typeof CodeInput>>) {
  const [value, setValue] = React.useState('');
  return <CodeInput aria-label="Code" value={value} onChange={setValue} onComplete={onComplete} {...props} />;
}

describe('CodeInput', () => {
  it.each(['123 456', '123-456', 'a123456789'])('sanitizes and clamps a paste of %s before maxLength can truncate it', (text) => {
    const complete = vi.fn();
    render(<Entry onComplete={complete} />);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => text } });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('123456');
    expect(complete).toHaveBeenCalledExactlyOnceWith('123456');
  });

  it('sanitizes typing and autofill, uses the supplied length, and notifies once under StrictMode', () => {
    const complete = vi.fn();
    const { rerender } = render(<React.StrictMode><Entry length={4} onComplete={complete} /></React.StrictMode>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a12-345' } });
    rerender(<React.StrictMode><Entry length={4} onComplete={complete} /></React.StrictMode>);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('1234');
    expect(complete).toHaveBeenCalledExactlyOnceWith('1234');
  });

  it('does not re-fire a failed complete value until the value changes', () => {
    const complete = vi.fn();
    const { rerender } = render(<Entry onComplete={complete} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
    rerender(<Entry state="error" onComplete={complete} />);
    fireEvent.blur(screen.getByRole('textbox'));
    fireEvent.focus(screen.getByRole('textbox'));
    expect(complete).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12345' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not submit an already failed value on mount or when its error clears', () => {
    const complete = vi.fn();
    const { rerender } = render(<CodeInput value="123456" onChange={vi.fn()} onComplete={complete} state="error" />);
    rerender(<CodeInput value="123456" onChange={vi.fn()} onComplete={complete} />);
    expect(complete).not.toHaveBeenCalled();
  });

  it('never completes or changes a disabled field', () => {
    const complete = vi.fn();
    const change = vi.fn();
    render(<CodeInput value="123456" onChange={change} onComplete={complete} disabled />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '654321' } });
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => '654321' } });
    expect(complete).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

  it('has one input, decorative cells, an LTR row in RTL, and all accessible label attributes', () => {
    const { container } = render(<div dir="rtl"><span id="label">Security code</span><p id="help">Six digits</p>
      <CodeInput id="code" name="otp" value="123" onChange={vi.fn()} aria-labelledby="label" aria-describedby="help" state="error" />
    </div>);
    const input = screen.getByRole('textbox', { name: 'Security code' });
    expect(container.querySelectorAll('input')).toHaveLength(1);
    expect(container.querySelector('.ao-code-cells')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.ao-code-cell')).toHaveLength(6);
    expect(input.parentElement?.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('id')).toBe('code');
    expect(input.getAttribute('name')).toBe('otp');
    expect(input.getAttribute('aria-describedby')).toBe('help');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
    expect(input.getAttribute('maxlength')).toBe('6');
  });

  it('passes aria-label through and rings only the current cell while focused', () => {
    const { container } = render(<Entry />);
    const input = screen.getByRole('textbox', { name: 'Code' });
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12' } });
    expect(container.querySelector('[data-current]')).toBe(container.querySelectorAll('.ao-code-cell')[2]);
    fireEvent.blur(input);
    expect(container.querySelector('[data-current]')).toBeNull();
  });

  it('keeps the input mounted across error feedback and renders safely on the server', () => {
    const { rerender } = render(<Entry />);
    const input = screen.getByRole('textbox');
    rerender(<Entry state="error" />);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(renderToString(<CodeInput value="" onChange={vi.fn()} />)).toContain('one-time-code');
  });
});
