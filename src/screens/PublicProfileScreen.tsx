import React from 'react';
import MyProfileScreen from './MyProfileScreen';

type Props = React.ComponentProps<typeof MyProfileScreen>;

export default function PublicProfileScreen(props: Props) {
  return <MyProfileScreen {...props} isOwnProfile={false} />;
}

