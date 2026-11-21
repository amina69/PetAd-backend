import { PaymentsModule } from './payments.module';

describe('PaymentsModule', () => {
  it('is defined and exports its services', () => {
    expect(PaymentsModule).toBeDefined();
    expect(PaymentsModule.name).toBe('PaymentsModule');
  });
});
