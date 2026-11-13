import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrafficIdentities } from 'src/traffic/TrafficIdentities';

const setup = (ids: string[]) => {
  const onChange = jest.fn();
  render(<TrafficIdentities ids={ids} onChange={onChange} />);
  return { onChange, input: screen.getByRole('combobox') };
};

describe('TrafficIdentities', () => {
  it('shows each identity as a chip', () => {
    setup(['service:a']);
    expect(screen.getByText('service:a')).toBeInTheDocument();
    expect(screen.getByText('Live traffic')).toBeInTheDocument();
  });

  it('adds a valid identity on Enter', async () => {
    const { onChange, input } = setup(['service:a']);
    await userEvent.type(input, 'host:*.magicline.com{enter}');
    expect(onChange).toHaveBeenCalledWith(['service:a', 'host:*.magicline.com']);
  });

  it('refuses an invalid identity with an inline error', async () => {
    const { onChange, input } = setup(['service:a']);
    await userEvent.type(input, 'ftp:x{enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Start with service:/)).toBeInTheDocument();
  });

  it('ignores an identity that is already there', async () => {
    const { onChange, input } = setup(['service:a']);
    await userEvent.type(input, 'service:a{enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a 21st identity', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `service:s${i}`);
    const { onChange, input } = setup(ids);
    await userEvent.type(input, 'service:extra{enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('At most 20 identities')).toBeInTheDocument();
  });

  it('reports undefined when the last chip is deleted', async () => {
    const { onChange } = setup(['service:a']);
    const chip = screen.getByText('service:a').closest('.MuiChip-root');
    await userEvent.click(chip?.querySelector('.MuiChip-deleteIcon') as Element);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
