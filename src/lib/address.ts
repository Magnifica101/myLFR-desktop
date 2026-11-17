import type { BusinessProfileInput } from './types';

type AddressParts = Pick<BusinessProfileInput, 'streetNumber' | 'streetName' | 'streetType' | 'suburb' | 'city' | 'postcode'>;

/** The business address as up to three lines, as it would be written on an
 * envelope: street, suburb, then city and postcode. Empty parts are left out,
 * so a missing suburb drops its line. */
export function addressLines(address: AddressParts) {
  return [
    [address.streetNumber, address.streetName, address.streetType],
    [address.suburb],
    [address.city, address.postcode],
  ].map((parts) => parts.map((part) => part.trim()).filter(Boolean).join(' ')).filter(Boolean);
}
