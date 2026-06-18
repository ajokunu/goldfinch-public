/**
 * Thin re-export of the promoted shared FormField (app/src/ui/FormField.tsx).
 * The kit props are a superset of this feature's historical copy (including
 * `hint`), so existing call sites compile unchanged.
 */
export { FormField, type FormFieldProps } from '../../../src/ui/FormField';
