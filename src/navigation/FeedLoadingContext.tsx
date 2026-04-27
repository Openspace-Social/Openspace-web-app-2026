/**
 * FeedLoadingContext — tiny shared state for the feed loading indicator.
 *
 * The FeedSubTabs pill row lives inside the stack header (AppNavigator →
 * FeedScreenHeader), while the feed fetch lives inside FeedScreenContainer.
 * This context bridges the two so the header can show a progress bar under
 * the sub-tabs whenever the container is fetching, without having to lift
 * all the feed state upward.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';

type FeedLoadingContextValue = {
  isLoadingFeed: boolean;
  setIsLoadingFeed: (loading: boolean) => void;
};

const FeedLoadingContext = createContext<FeedLoadingContextValue>({
  isLoadingFeed: false,
  setIsLoadingFeed: () => {},
});

export function FeedLoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const value = useMemo(() => ({ isLoadingFeed, setIsLoadingFeed }), [isLoadingFeed]);
  return <FeedLoadingContext.Provider value={value}>{children}</FeedLoadingContext.Provider>;
}

export function useFeedLoading() {
  return useContext(FeedLoadingContext);
}
