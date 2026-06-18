/**
 * Thin re-export of the shared FormField (app/src/ui/FormField.tsx). The kit
 * props are a superset of the previous feature-local copy (label, error,
 * additive hint), so this is a pure promotion with no call-site churn.
 */
export { FormField, type FormFieldProps } from '../../../src/ui/FormField';
