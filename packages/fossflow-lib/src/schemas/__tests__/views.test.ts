import { viewItemSchema, viewSchema, viewsSchema } from '../views';

describe('viewItemSchema', () => {
  it('validates a correct view item', () => {
    const valid = { id: 'item1', tile: { x: 1, y: 2 } };
    expect(viewItemSchema.safeParse(valid).success).toBe(true);
  });
  it('fails if required fields are missing', () => {
    const invalid = { tile: { x: 1, y: 2 } };
    const result = viewItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue: any) => {
          return issue.path.includes('id');
        })
      ).toBe(true);
    }
  });
});

describe('viewSchema', () => {
  it('validates a correct view', () => {
    const valid = {
      id: 'view1',
      name: 'View',
      items: [{ id: 'item1', tile: { x: 0, y: 0 } }]
    };
    expect(viewSchema.safeParse(valid).success).toBe(true);
  });
  it('fails if items is missing', () => {
    const invalid = { id: 'view1', name: 'View' };
    const result = viewSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue: any) => {
          return issue.path.includes('items');
        })
      ).toBe(true);
    }
  });
  // zod 4 requires seconds next to `Z` (RFC 3339); zod 3 also accepted `T00:00Z`.
  it('accepts lastUpdated only as an ISO datetime with seconds', () => {
    const view = (lastUpdated: string) => {
      return { id: 'view1', name: 'View', items: [], lastUpdated };
    };
    expect(viewSchema.safeParse(view(new Date().toISOString())).success).toBe(true);
    expect(viewSchema.safeParse(view('2024-01-01T00:00:00Z')).success).toBe(true);
    expect(viewSchema.safeParse(view('2024-01-01T00:00Z')).success).toBe(false);
    expect(viewSchema.safeParse(view('2024-01-01T00:00:00+02:00')).success).toBe(false);
  });
});

describe('viewsSchema', () => {
  it('validates an array of views', () => {
    const valid = [
      {
        id: 'view1',
        name: 'View',
        items: [{ id: 'item1', tile: { x: 0, y: 0 } }]
      }
    ];
    expect(viewsSchema.safeParse(valid).success).toBe(true);
  });
  it('fails if any view is invalid', () => {
    const invalid = [
      {
        id: 'view1',
        name: 'View',
        items: [{ id: 'item1', tile: { x: 0, y: 0 } }]
      },
      { id: 'view2', name: 'View2' }
    ];
    const result = viewsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue: any) => {
          return issue.path.includes('items');
        })
      ).toBe(true);
    }
  });
});
