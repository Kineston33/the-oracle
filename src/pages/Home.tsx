import { Hero } from './home/Hero';
import { PrincipleSection } from './home/PrincipleSection';
import { ArchiveSection } from './home/ArchiveSection';
import { MethodSection } from './home/MethodSection';

export function Home() {
  return (
    <>
      <Hero />
      <PrincipleSection />
      <ArchiveSection />
      <MethodSection />
    </>
  );
}
