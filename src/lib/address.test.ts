import { addressLines } from './address';

const empty = { streetNumber: '', streetName: '', streetType: '', suburb: '', city: '', postcode: '' };

describe('addressLines', () => {
  it('writes street, suburb, then city and postcode', () => {
    expect(addressLines({ streetNumber: '12', streetName: 'Wharf', streetType: 'Road', suburb: 'Port Chalmers', city: 'Dunedin', postcode: '9023' }))
      .toEqual(['12 Wharf Road', 'Port Chalmers', 'Dunedin 9023']);
  });

  it('leaves out empty and blank parts', () => {
    expect(addressLines({ ...empty, streetName: 'Wharf', suburb: '  ', postcode: '9023' })).toEqual(['Wharf', '9023']);
  });

  it('has no lines when every part is empty', () => {
    expect(addressLines(empty)).toEqual([]);
  });
});
