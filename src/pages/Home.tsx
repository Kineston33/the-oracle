import { Hero } from './home/Hero';
import { PrincipleSection } from './home/PrincipleSection';
import { TrendsSection } from './home/TrendsSection';
import { ArchiveSection } from './home/ArchiveSection';
import { MethodSection } from './home/MethodSection';

export function Home() {
  return (
    <>
      <Hero />
      <PrincipleSection />
      <TrendsSection />
      <ArchiveSection />
      <MethodSection />
    </>
  );
}
