/**
 * Category editor icon + color picker (ops/PHASE10-DECISIONS.md P10-5): the
 * editor shows Icon and Color rows that open their picker sheets; selecting a
 * glyph or swatch updates the live preview chip and is sent on the create /
 * patch mutation body. Covers the create path (new category) and the patch
 * path (existing category seeds its stored keys into the pickers).
 *
 * The CategoryIcon-honors-iconKey-then-falls-back precedence is unit + render
 * tested in icons.test.tsx; this suite exercises the editor wiring end to end
 * through the real mutation hooks and the fetch-level mockApi.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { CategoryEditorModal } from '../features/budget/components/CategoryEditorModal';
import { makeCategoryDto } from './fixtures';
import { mockApi, type MockRequest } from './mockApi';
import { renderWithProviders } from './render';

describe('CategoryEditorModal — icon + color pickers (P10-5)', () => {
  it('renders the Icon and Color rows with a live preview', async () => {
    renderWithProviders(
      <CategoryEditorModal
        visible
        existingGroupIds={[]}
        onClose={() => {}}
      />,
    );

    // Both picker rows and the preview chip are present.
    expect(await screen.findByTestId('category-editor-preview')).toBeOnTheScreen();
    expect(screen.getByTestId('category-editor-icon-row')).toBeOnTheScreen();
    expect(screen.getByTestId('category-editor-color-row')).toBeOnTheScreen();
  });

  it('selecting an icon updates the preview and sends iconKey on create', async () => {
    let created: MockRequest | undefined;
    mockApi.on('POST', '/categories', (request) => {
      created = request;
      return { status: 201, body: makeCategoryDto({ categoryId: 'gaming' }) };
    });
    // Standalone modal has no categories-list observer, so the post-create
    // invalidate never refetches; no GET /categories route is needed.

    renderWithProviders(
      <CategoryEditorModal
        visible
        existingGroupIds={[]}
        onClose={() => {}}
      />,
    );

    // Name the category, open the icon picker, pick the game-controller glyph.
    fireEvent.changeText(await screen.findByLabelText('Name'), 'Gaming');
    fireEvent.press(screen.getByTestId('category-editor-icon-row'));
    fireEvent.press(
      await screen.findByTestId('icon-picker-cell-game-controller'),
    );

    // Preview chip now renders the chosen game-controller glyph.
    const preview = await screen.findByTestId('category-editor-preview');
    await waitFor(() =>
      expect(
        within(preview).getByTestId(
          'phosphor-react-native-game-controller-duotone',
        ),
      ).toBeOnTheScreen(),
    );

    // Save; the create body carries the chosen iconKey.
    fireEvent.press(screen.getByText('Create category'));
    await waitFor(() => expect(created).toBeDefined());
    expect(created?.body).toMatchObject({
      name: 'Gaming',
      type: 'EXPENSE',
      iconKey: 'game-controller',
    });
  });

  it('selecting a color sends the palette key on create', async () => {
    let created: MockRequest | undefined;
    mockApi.on('POST', '/categories', (request) => {
      created = request;
      return { status: 201, body: makeCategoryDto({ categoryId: 'gaming' }) };
    });

    renderWithProviders(
      <CategoryEditorModal
        visible
        existingGroupIds={[]}
        onClose={() => {}}
      />,
    );

    fireEvent.changeText(await screen.findByLabelText('Name'), 'Gaming');
    fireEvent.press(screen.getByTestId('category-editor-color-row'));
    fireEvent.press(await screen.findByTestId('color-picker-swatch-c4'));

    fireEvent.press(screen.getByText('Create category'));
    await waitFor(() => expect(created).toBeDefined());
    expect(created?.body).toMatchObject({ name: 'Gaming', color: 'c4' });
  });

  it('seeds stored iconKey/color into the editor when editing', async () => {
    const category = {
      ...makeCategoryDto({ categoryId: 'groceries', name: 'Groceries' }),
      iconKey: 'coffee',
      color: 'c2',
    };
    let patched: MockRequest | undefined;
    mockApi.on('PATCH', '/categories/groceries', (request) => {
      patched = request;
      return { status: 200, body: category };
    });

    renderWithProviders(
      <CategoryEditorModal
        visible
        category={category}
        existingGroupIds={[]}
        onClose={() => {}}
      />,
    );

    // The preview reflects the STORED coffee glyph (not the groceries slug).
    const preview = await screen.findByTestId('category-editor-preview');
    await waitFor(() =>
      expect(
        within(preview).getByTestId('phosphor-react-native-coffee-duotone'),
      ).toBeOnTheScreen(),
    );

    // Saving without touching the pickers re-sends the seeded keys.
    fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(patched).toBeDefined());
    expect(patched?.body).toMatchObject({ iconKey: 'coffee', color: 'c2' });
  });
});
