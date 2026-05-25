import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';

afterEach(cleanup);

describe('Tabs', () => {
  it('renders tabs with trigger and content', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole('tab', { name: 'Tab A' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Tab B' })).toBeDefined();
    expect(screen.getByText('Content A')).toBeDefined();
  });

  it('forwards custom className on TabsList', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList className="my-list">
          <TabsTrigger value="a">Tab A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content</TabsContent>
      </Tabs>,
    );
    const list = container.querySelector('[role="tablist"]');
    expect(list!.className).toContain('my-list');
  });

  it('forwards custom className on TabsTrigger', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" className="my-trigger">
            Tab A
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content</TabsContent>
      </Tabs>,
    );
    const trigger = container.querySelector('.my-trigger');
    expect(trigger).not.toBeNull();
  });

  it('forwards custom className on TabsContent', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
        </TabsList>
        <TabsContent value="a" className="my-content">
          Content
        </TabsContent>
      </Tabs>,
    );
    expect(container.querySelector('.my-content')).not.toBeNull();
  });
});
