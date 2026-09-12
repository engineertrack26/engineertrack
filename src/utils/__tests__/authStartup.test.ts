import { deferAuthWork, withAuthTimeout } from '../authStartup';

describe('auth startup scheduling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns from the auth callback before running profile work', () => {
    const order: string[] = [];
    function callback() {
      deferAuthWork(() => { order.push('profile query'); });
    }
    expect(callback()).toBeUndefined();
    order.push('lock released');
    expect(order).toEqual(['lock released']);
    jest.runOnlyPendingTimers();
    expect(order).toEqual(['lock released', 'profile query']);
  });

  it('cancels deferred work when the listener is disposed', () => {
    const work = jest.fn();
    const cancel = deferAuthWork(work);
    cancel();
    jest.runOnlyPendingTimers();
    expect(work).not.toHaveBeenCalled();
  });

  it('bounds an unresponsive session/profile request', async () => {
    const result = withAuthTimeout(new Promise(() => {}));
    const assertion = expect(result).rejects.toThrow('AUTH_STARTUP_TIMEOUT');
    await jest.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns successful results and removes the deadline timer', async () => {
    await expect(withAuthTimeout(Promise.resolve('session'))).resolves.toBe('session');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propagates failures and removes the deadline timer', async () => {
    await expect(withAuthTimeout(Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not replace a timeout with a late successful result', async () => {
    let resolve!: (value: string) => void;
    const work = new Promise<string>(done => { resolve = done; });
    const result = withAuthTimeout(work, 100);
    const assertion = expect(result).rejects.toThrow('AUTH_STARTUP_TIMEOUT');
    await jest.advanceTimersByTimeAsync(100);
    resolve('late session');
    await assertion;
    await expect(result).rejects.toThrow('AUTH_STARTUP_TIMEOUT');
  });
});
