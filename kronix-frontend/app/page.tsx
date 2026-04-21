import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import KXIBasket from "@/components/KXIBasket";
import Strategies from "@/components/Strategies";
import Trust from "@/components/Trust";

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <KXIBasket />
      <Strategies />
      <Trust />
    </>
  );
}
