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

  it('never completes a disabled field', () => {
    const complete = vi.fn();
    const change = vi.fn();
    render(<CodeInput value="123456" onChange={change} onComplete={complete} disabled />);
    expect(complete).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
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
    // The focus-within CSS gates the ring; React only marks the current cell.
    expect(container.querySelector('[data-current]')).toBe(container.querySelectorAll('.ao-code-cell')[2]);
  });

  it('keeps the input mounted across error feedback and renders safely on the server', () => {
    const { rerender } = render(<Entry />);
    const input = screen.getByRole('textbox');
    rerender(<Entry state="error" />);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(renderToString(<CodeInput value="" onChange={vi.fn()} />)).toContain('one-time-code');
  });
});


it.each(['123456', '12'])('replaces a %s field with a full-length paste', (value) => {
  const change = vi.fn();
  render(<CodeInput value={value} onChange={change} onComplete={vi.fn()} />);
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => '654-321-9' } });
  expect(change).toHaveBeenCalledExactlyOnceWith('654321');
});

it('appends a short paste, regardless of the caret position', () => {
  const change = vi.fn();
  render(<CodeInput value="12" onChange={change} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  input.setSelectionRange(0, 0);
  fireEvent.paste(input, { clipboardData: { getData: () => '3a4' } });
  expect(change).toHaveBeenCalledExactlyOnceWith('1234');
});

it('keeps a failed value and its error through an identical paste', () => {
  const change = vi.fn();
  render(<CodeInput value="123456" onChange={change} state="error" />);
  const input = screen.getByRole('textbox');
  fireEvent.paste(input, { clipboardData: { getData: () => '123-456' } });
  expect(change).not.toHaveBeenCalled();
  expect(input.getAttribute('aria-invalid')).toBe('true');
});

it('holds an IME draft and completes only after composition ends', () => {
  const complete = vi.fn();
  render(<Entry onComplete={complete} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'a123456' } });
  expect(input.value).toBe('a123456');
  expect(complete).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  expect(input.value).toBe('123456');
  expect(complete).toHaveBeenCalledExactlyOnceWith('123456');
});

it('keeps the caret at the end on focus, click, selection and arrow keys', () => {
  render(<CodeInput value="123" onChange={vi.fn()} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  for (const type of ['focus', 'click', 'select', 'keyDown'] as const) {
    input.setSelectionRange(0, 0);
    if (type === 'select') fireEvent(input, new Event('select', { bubbles: true }));
    else fireEvent[type](input, { key: 'ArrowLeft' });
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
  }
});

it.each([false, true])('submits its form exactly once with requestSubmit missing: %s', (missing) => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  function Form() {
    const [value, setValue] = React.useState('');
    return <form method="post" onSubmit={submit}><CodeInput value={value} onChange={setValue} /></form>;
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'requestSubmit')!;
  try {
    if (missing) Reflect.deleteProperty(HTMLFormElement.prototype, 'requestSubmit');
    render(<Form />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
    expect(submit).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', descriptor);
  }
});


it.each([
  ['Arabic-Indic', '١٢٣٤٥٦'],
  ['Persian', '۱۲۳۴۵۶'],
  ['full-width', '１２３４５６'],
])('normalizes %s digits for typing, paste and autofill', (_range, digits) => {
  const complete = vi.fn();
  const { unmount } = render(<Entry onComplete={complete} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  for (const digit of digits) fireEvent.input(input, { target: { value: input.value + digit }, inputType: 'insertText', data: digit });
  expect(input.value).toBe('123456');
  expect(complete).toHaveBeenCalledExactlyOnceWith('123456');
  unmount();
  const pasted = render(<Entry onComplete={complete} />);
  complete.mockClear();
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => digits } });
  expect(screen.getByRole('textbox')).toHaveProperty('value', '123456');
  expect(complete).toHaveBeenCalledExactlyOnceWith('123456');
  pasted.unmount();
  complete.mockClear();
  render(<Entry onComplete={complete} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: digits } });
  expect(screen.getByRole('textbox')).toHaveProperty('value', '123456');
  expect(complete).toHaveBeenCalledExactlyOnceWith('123456');
});

it.each(['keydown', 'beforeinput', 'input', 'composition', 'paste', 'partial paste', 'empty paste', 'Backspace', 'Delete'])('replaces a failed code on %s after focus and click collapse its selection', (action) => {
  function FailedEntry() {
    const [value, setValue] = React.useState('123456');
    return <CodeInput value={value} onChange={setValue} state="error" />;
  }
  render(<FailedEntry />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.click(input);
  fireEvent.keyDown(input, { key: 'ArrowLeft' });
  input.setSelectionRange(6, 6);
  if (action === 'beforeinput') fireEvent(input, new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '٧' }));
  else if (action === 'input') fireEvent.input(input, { target: { value: '123456٧' }, inputType: 'insertText', data: '٧' });
  else if (action === 'composition') {
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '123456７' } });
    fireEvent.compositionEnd(input, { data: '７' });
  }
  else if (action.includes('paste')) fireEvent.paste(input, { clipboardData: { getData: () => action === 'paste' ? '٧٦٥٤٣٢' : action === 'partial paste' ? '٧٦' : 'letters' } });
  else fireEvent.keyDown(input, { key: action === 'keydown' ? '7' : action });
  const expected = action === 'paste' ? '765432' : action === 'partial paste' ? '76' : ['empty paste', 'Backspace', 'Delete'].includes(action) ? '' : '7';
  expect(input.value).toBe(expected);
  if (expected.length < 6) {
    fireEvent.input(input, { target: { value: expected + '8' }, inputType: 'insertText', data: '8' });
    expect(input.value).toBe(expected + '8');
  }
});
